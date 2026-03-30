from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse
import xmlrpc.client

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - optional dependency
    Image = None
    ImageOps = None


LOGGER = logging.getLogger("odoo_image_pipeline")

EXTERNAL_ID_HEADERS = (
    "id",
    "External ID",
    "external id",
    "external_id",
    "xml id",
    "xml_id",
)

PRIMARY_IMAGE_HEADERS = (
    "Image URL",
    "image url",
    "Image URL (Main)",
    "image url (main)",
    "image_url",
    "image_1920",
)


@dataclass(slots=True)
class OdooCredentials:
    base_url: str
    database: str
    username: str
    password: str


@dataclass(slots=True)
class PipelineOptions:
    timeout_seconds: int = 15
    retries: int = 3
    concurrency: int = 6
    allow_url_for_new_imports: bool = True
    skip_if_same_image: bool = True
    upload_gallery_images: bool = False
    max_image_size: tuple[int, int] = (1600, 1600)
    jpeg_quality: int = 85


@dataclass(slots=True)
class ProductJob:
    row_id: str
    raw: Dict[str, Any]
    product_name: Optional[str]
    sku: Optional[str]
    external_id: Optional[str]
    image_url: Optional[str]
    additional_image_urls: List[str] = field(default_factory=list)
    create_values: Dict[str, Any] = field(default_factory=dict)
    update_values: Dict[str, Any] = field(default_factory=dict)

    @property
    def operation(self) -> str:
        return "update" if self.external_id else "new"


@dataclass(slots=True)
class DownloadedImage:
    url: str
    base64_value: str
    sha256: str
    content_type: Optional[str]
    byte_count: int


@dataclass(slots=True)
class PreparedProductImage:
    row_id: str
    operation: str
    external_id: Optional[str]
    product_name: Optional[str]
    sku: Optional[str]
    image_url: Optional[str]
    image_base64: Optional[str]
    additional_images: List[DownloadedImage]
    strategy: str
    reason: Optional[str]
    sha256: Optional[str]
    errors: List[str]
    job: ProductJob


@dataclass(slots=True)
class SyncOutcome:
    row_id: str
    operation: str
    external_id: Optional[str]
    template_id: Optional[int]
    success: bool
    skipped: bool
    reason: Optional[str]
    errors: List[str] = field(default_factory=list)


class ImageCache:
    def __init__(self) -> None:
        self._items: dict[str, DownloadedImage] = {}
        self._failures: dict[str, str] = {}

    def set(self, url: str, image: DownloadedImage) -> None:
        self._items[url] = image

    def set_failure(self, url: str, reason: str) -> None:
        self._failures[url] = reason

    def get(self, url: str) -> Optional[DownloadedImage]:
        return self._items.get(url)

    def get_failure(self, url: str) -> Optional[str]:
        return self._failures.get(url)

    @property
    def failures(self) -> dict[str, str]:
        return dict(self._failures)


def normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = " ".join(value.split()).strip()
    return value or None


def normalize_url(value: Any) -> Optional[str]:
    normalized = normalize_text(value)
    if not normalized:
        return None
    if normalized.lower().startswith(("http://", "https://")):
        return normalized
    return None


def dedupe_urls(values: Iterable[Optional[str]]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for value in values:
        url = normalize_url(value)
        if not url or url in seen:
            continue
        seen.add(url)
        result.append(url)
    return result


def extract_external_id(raw: Dict[str, Any]) -> Optional[str]:
    for header in EXTERNAL_ID_HEADERS:
        if header in raw:
            value = normalize_text(raw.get(header))
            if value:
                return value
    return None


def extract_primary_image_url(raw: Dict[str, Any]) -> Optional[str]:
    for header in PRIMARY_IMAGE_HEADERS:
        if header in raw:
            value = normalize_url(raw.get(header))
            if value:
                return value
    return None


def extract_additional_image_urls(raw: Dict[str, Any]) -> List[str]:
    values: List[str] = []
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        if not key.lower().startswith("image url (var ") and "additional image" not in key.lower():
            continue
        if isinstance(value, str):
            values.extend(part.strip() for part in value.replace("\n", ",").split(","))
    return dedupe_urls(values)


def build_product_job(raw: Dict[str, Any], row_number: int) -> ProductJob:
    return ProductJob(
        row_id=str(raw.get("id") or row_number),
        raw=raw,
        product_name=normalize_text(raw.get("Product Name") or raw.get("Name")),
        sku=normalize_text(raw.get("SKU") or raw.get("Internal Reference")),
        external_id=extract_external_id(raw),
        image_url=extract_primary_image_url(raw),
        additional_image_urls=extract_additional_image_urls(raw),
    )


def build_requests_session(options: PipelineOptions) -> requests.Session:
    retry = Retry(
        total=options.retries,
        backoff_factor=0.75,
        status_forcelist=(408, 423, 425, 429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=options.concurrency, pool_maxsize=options.concurrency)
    session = requests.Session()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update({"Accept": "image/*"})
    return session


def is_image_response(content_type: Optional[str], url: str) -> bool:
    if content_type and content_type.lower().startswith("image/"):
        return True
    path = urlparse(url).path.lower()
    return path.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"))


def optimize_image_bytes(image_bytes: bytes, options: PipelineOptions) -> bytes:
    if not Image or not ImageOps:
        return image_bytes

    with Image.open(io.BytesIO(image_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail(options.max_image_size)
        output = io.BytesIO()

        has_alpha = image.mode in ("RGBA", "LA") or (
            image.mode == "P" and "transparency" in image.info
        )

        if has_alpha:
            image.save(output, format="PNG", optimize=True)
        else:
            converted = image.convert("RGB")
            converted.save(
                output,
                format="JPEG",
                optimize=True,
                quality=options.jpeg_quality,
                progressive=True,
            )

        return output.getvalue()


def download_and_encode_image(
    session: requests.Session,
    url: str,
    options: PipelineOptions,
) -> DownloadedImage:
    response = session.get(url, timeout=options.timeout_seconds, stream=True)
    try:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type")
        if not is_image_response(content_type, url):
            raise ValueError(f"URL does not point to a supported image: {url}")

        image_bytes = response.content
    finally:
        response.close()

    optimized_bytes = optimize_image_bytes(image_bytes, options)
    base64_value = base64.b64encode(optimized_bytes).decode("ascii")
    sha256 = hashlib.sha256(optimized_bytes).hexdigest()

    return DownloadedImage(
        url=url,
        base64_value=base64_value,
        sha256=sha256,
        content_type=response.headers.get("Content-Type"),
        byte_count=len(optimized_bytes),
    )


def prime_image_cache(
    jobs: List[ProductJob],
    options: PipelineOptions,
) -> ImageCache:
    # Download each unique URL once so repeated Cloudinary links are reused
    # across the whole batch instead of being fetched row by row.
    cache = ImageCache()
    session = build_requests_session(options)
    unique_urls = dedupe_urls(
        [
            job.image_url
            for job in jobs
        ]
        + [url for job in jobs for url in job.additional_image_urls]
    )

    with ThreadPoolExecutor(max_workers=options.concurrency) as executor:
        future_map = {
            executor.submit(download_and_encode_image, session, url, options): url
            for url in unique_urls
        }

        for future in as_completed(future_map):
            url = future_map[future]
            try:
                image = future.result()
                cache.set(url, image)
                LOGGER.info("Prepared base64 image for %s", url)
            except Exception as exc:  # pragma: no cover - network errors vary
                message = str(exc)
                cache.set_failure(url, message)
                LOGGER.error("Failed to prepare image for %s: %s", url, message)

    session.close()
    return cache


def prepare_product_images(
    jobs: List[ProductJob],
    cache: ImageCache,
    *,
    target_mode: str,
    allow_url_for_new_imports: bool,
) -> List[PreparedProductImage]:
    # Existing products always prepare image_1920 as base64 for API writes.
    # New spreadsheet imports can optionally keep a remote image URL instead.
    prepared: List[PreparedProductImage] = []

    for job in jobs:
        if not job.image_url:
            prepared.append(
                PreparedProductImage(
                    row_id=job.row_id,
                    operation=job.operation,
                    external_id=job.external_id,
                    product_name=job.product_name,
                    sku=job.sku,
                    image_url=None,
                    image_base64=None,
                    additional_images=[],
                    strategy="none",
                    reason="No image URL was provided.",
                    sha256=None,
                    errors=[],
                    job=job,
                )
            )
            continue

        if (
            target_mode == "odoo_import"
            and job.operation == "new"
            and allow_url_for_new_imports
        ):
            prepared.append(
                PreparedProductImage(
                    row_id=job.row_id,
                    operation=job.operation,
                    external_id=job.external_id,
                    product_name=job.product_name,
                    sku=job.sku,
                    image_url=job.image_url,
                    image_base64=None,
                    additional_images=[],
                    strategy="url",
                    reason="New-product import can keep the remote image URL.",
                    sha256=None,
                    errors=[],
                    job=job,
                )
            )
            continue

        main_image = cache.get(job.image_url)
        if not main_image:
            reason = cache.get_failure(job.image_url) or "Image download failed."
            prepared.append(
                PreparedProductImage(
                    row_id=job.row_id,
                    operation=job.operation,
                    external_id=job.external_id,
                    product_name=job.product_name,
                    sku=job.sku,
                    image_url=job.image_url,
                    image_base64=None,
                    additional_images=[],
                    strategy="skip",
                    reason=reason,
                    sha256=None,
                    errors=[reason],
                    job=job,
                )
            )
            continue

        additional_images = [
            image
            for url in job.additional_image_urls
            for image in [cache.get(url)]
            if image is not None
        ]

        prepared.append(
            PreparedProductImage(
                row_id=job.row_id,
                operation=job.operation,
                external_id=job.external_id,
                product_name=job.product_name,
                sku=job.sku,
                image_url=main_image.url,
                image_base64=main_image.base64_value,
                additional_images=additional_images,
                strategy="base64",
                reason="image_1920 requires a clean base64 payload for API writes.",
                sha256=main_image.sha256,
                errors=[],
                job=job,
            )
        )

    return prepared


def build_odoo_import_row(
    prepared: PreparedProductImage,
    *,
    url_column: str = "Image URL",
    base64_column: str = "image_1920",
) -> Dict[str, Any]:
    row = dict(prepared.job.raw)
    if prepared.strategy == "url" and prepared.image_url:
        row[url_column] = prepared.image_url
    if prepared.strategy == "base64" and prepared.image_base64:
        row[base64_column] = prepared.image_base64
    return row


def split_external_id(external_id: str) -> tuple[Optional[str], str]:
    if "." not in external_id:
        return None, external_id
    module, name = external_id.split(".", 1)
    return module, name


class OdooXmlRpcClient:
    def __init__(self, credentials: OdooCredentials) -> None:
        self.credentials = credentials
        base_url = credentials.base_url.rstrip("/")
        self._common = xmlrpc.client.ServerProxy(f"{base_url}/xmlrpc/2/common", allow_none=True)
        self._models = xmlrpc.client.ServerProxy(f"{base_url}/xmlrpc/2/object", allow_none=True)
        self._uid: Optional[int] = None

    @property
    def uid(self) -> int:
        if self._uid is None:
            self._uid = self._common.authenticate(
                self.credentials.database,
                self.credentials.username,
                self.credentials.password,
                {},
            )
            if not self._uid:
                raise RuntimeError("Failed to authenticate with Odoo.")
        return self._uid

    def execute_kw(self, model: str, method: str, args: list[Any], kwargs: Optional[dict[str, Any]] = None) -> Any:
        return self._models.execute_kw(
            self.credentials.database,
            self.uid,
            self.credentials.password,
            model,
            method,
            args,
            kwargs or {},
        )

    def resolve_product_template_ids(self, external_ids: Iterable[str]) -> dict[str, int]:
        external_ids = list(dict.fromkeys(external_ids))
        complete_names = [value for value in external_ids if "." in value]
        short_names = [split_external_id(value)[1] for value in external_ids]

        domain: list[Any] = [["model", "=", "product.template"]]
        if complete_names and short_names:
            domain.extend(["|", ["complete_name", "in", complete_names], ["name", "in", short_names]])
        elif complete_names:
            domain.append(["complete_name", "in", complete_names])
        elif short_names:
            domain.append(["name", "in", short_names])

        records = self.execute_kw(
            "ir.model.data",
            "search_read",
            [domain],
            {"fields": ["complete_name", "name", "res_id"]},
        )

        resolved: dict[str, int] = {}
        for record in records:
            if record.get("complete_name"):
                resolved[record["complete_name"]] = record["res_id"]
            if record.get("name"):
                resolved[record["name"]] = record["res_id"]

        return resolved

    def read_current_image_hashes(self, template_ids: Iterable[int]) -> dict[int, str]:
        template_ids = list(template_ids)
        if not template_ids:
            return {}

        records = self.execute_kw(
            "product.template",
            "read",
            [template_ids],
            {"fields": ["image_1920"]},
        )

        hashes: dict[int, str] = {}
        for record in records:
            image_value = record.get("image_1920")
            if image_value:
                hashes[record["id"]] = hashlib.sha256(
                    base64.b64decode(image_value)
                ).hexdigest()
        return hashes


def default_create_values(job: ProductJob) -> Dict[str, Any]:
    values = dict(job.create_values)
    if "name" not in values and job.product_name:
        values["name"] = job.product_name
    if "default_code" not in values and job.sku:
        values["default_code"] = job.sku
    return values


def default_update_values(job: ProductJob) -> Dict[str, Any]:
    return dict(job.update_values)


def sync_products_to_odoo(
    prepared_jobs: List[PreparedProductImage],
    client: OdooXmlRpcClient,
    options: PipelineOptions,
) -> List[SyncOutcome]:
    outcomes: List[SyncOutcome] = []
    # Resolve External IDs once up front so every update can call write() by id.
    update_external_ids = [job.external_id for job in prepared_jobs if job.operation == "update" and job.external_id]
    external_id_map = client.resolve_product_template_ids(update_external_ids) if update_external_ids else {}
    current_hashes = (
        client.read_current_image_hashes(external_id_map.values())
        if options.skip_if_same_image and external_id_map
        else {}
    )

    for prepared in prepared_jobs:
        if prepared.errors:
            outcomes.append(
                SyncOutcome(
                    row_id=prepared.row_id,
                    operation=prepared.operation,
                    external_id=prepared.external_id,
                    template_id=None,
                    success=False,
                    skipped=True,
                    reason=prepared.reason,
                    errors=prepared.errors,
                )
            )
            continue

        try:
            if prepared.operation == "update":
                template_id = external_id_map.get(prepared.external_id or "")
                if not template_id:
                    outcomes.append(
                        SyncOutcome(
                            row_id=prepared.row_id,
                            operation=prepared.operation,
                            external_id=prepared.external_id,
                            template_id=None,
                            success=False,
                            skipped=True,
                            reason="External ID was not found in Odoo.",
                            errors=[f'Unable to resolve External ID "{prepared.external_id}".'],
                        )
                    )
                    continue

                values = default_update_values(prepared.job)
                if prepared.image_base64:
                    values["image_1920"] = prepared.image_base64

                if (
                    options.skip_if_same_image
                    and prepared.sha256
                    and current_hashes.get(template_id) == prepared.sha256
                    and not prepared.job.update_values
                ):
                    outcomes.append(
                        SyncOutcome(
                            row_id=prepared.row_id,
                            operation=prepared.operation,
                            external_id=prepared.external_id,
                            template_id=template_id,
                            success=True,
                            skipped=True,
                            reason="Image already matches Odoo.",
                        )
                    )
                    continue

                if values:
                    client.execute_kw("product.template", "write", [[template_id], values])

                if options.upload_gallery_images:
                    for image in prepared.additional_images:
                        client.execute_kw(
                            "product.image",
                            "create",
                            [
                                {
                                    "name": prepared.product_name or prepared.sku or "Additional image",
                                    "product_tmpl_id": template_id,
                                    "image_1920": image.base64_value,
                                }
                            ],
                        )

                LOGGER.info("Updated product.template %s", template_id)
                outcomes.append(
                    SyncOutcome(
                        row_id=prepared.row_id,
                        operation=prepared.operation,
                        external_id=prepared.external_id,
                        template_id=template_id,
                        success=True,
                        skipped=False,
                        reason="Updated product image.",
                    )
                )
                continue

            values = default_create_values(prepared.job)
            if prepared.image_base64:
                values["image_1920"] = prepared.image_base64

            template_id = client.execute_kw("product.template", "create", [values])

            if options.upload_gallery_images:
                for image in prepared.additional_images:
                    client.execute_kw(
                        "product.image",
                        "create",
                        [
                            {
                                "name": prepared.product_name or prepared.sku or "Additional image",
                                "product_tmpl_id": template_id,
                                "image_1920": image.base64_value,
                            }
                        ],
                    )

            LOGGER.info("Created product.template %s", template_id)
            outcomes.append(
                SyncOutcome(
                    row_id=prepared.row_id,
                    operation=prepared.operation,
                    external_id=prepared.external_id,
                    template_id=template_id,
                    success=True,
                    skipped=False,
                    reason="Created product.",
                )
            )
        except Exception as exc:  # pragma: no cover - remote API failures vary
            message = str(exc)
            LOGGER.error(
                "Odoo sync failed for row %s (%s): %s",
                prepared.row_id,
                prepared.external_id or prepared.product_name,
                message,
            )
            outcomes.append(
                SyncOutcome(
                    row_id=prepared.row_id,
                    operation=prepared.operation,
                    external_id=prepared.external_id,
                    template_id=None,
                    success=False,
                    skipped=False,
                    reason="Odoo API call failed.",
                    errors=[message],
                )
            )

    return outcomes


def load_rows_from_csv(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and sync Odoo product images from remote URLs.")
    parser.add_argument("--csv", type=Path, required=True, help="CSV file containing product rows.")
    parser.add_argument("--base-url", help="Odoo base URL, for example https://odoo.example.com")
    parser.add_argument("--db", help="Odoo database name")
    parser.add_argument("--username", help="Odoo username")
    parser.add_argument("--password", help="Odoo password")
    parser.add_argument("--dry-run", action="store_true", help="Prepare images without calling Odoo.")
    parser.add_argument("--failures-json", type=Path, help="Optional file to store failed image URLs.")
    parser.add_argument("--prepared-json", type=Path, help="Optional file to store prepared payloads.")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    options = PipelineOptions()

    raw_rows = load_rows_from_csv(args.csv)
    jobs = [build_product_job(row, index + 1) for index, row in enumerate(raw_rows)]
    cache = prime_image_cache(jobs, options)
    prepared_jobs = prepare_product_images(
        jobs,
        cache,
        target_mode="odoo_api",
        allow_url_for_new_imports=options.allow_url_for_new_imports,
    )

    if args.failures_json:
        write_json(args.failures_json, cache.failures)

    if args.prepared_json:
        write_json(
            args.prepared_json,
            [
                {
                    "row_id": item.row_id,
                    "operation": item.operation,
                    "external_id": item.external_id,
                    "image_url": item.image_url,
                    "strategy": item.strategy,
                    "reason": item.reason,
                    "errors": item.errors,
                }
                for item in prepared_jobs
            ],
        )

    if args.dry_run:
        LOGGER.info("Prepared %s rows in dry-run mode.", len(prepared_jobs))
        return

    if not all([args.base_url, args.db, args.username, args.password]):
        raise SystemExit("Odoo credentials are required unless --dry-run is used.")

    client = OdooXmlRpcClient(
        OdooCredentials(
            base_url=args.base_url,
            database=args.db,
            username=args.username,
            password=args.password,
        )
    )
    outcomes = sync_products_to_odoo(prepared_jobs, client, options)
    LOGGER.info("Finished sync: %s", json.dumps([asdict(outcome) for outcome in outcomes], indent=2))


if __name__ == "__main__":
    main()
