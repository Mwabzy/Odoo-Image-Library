# Odoo Image Library

Odoo Image Library is a spreadsheet-driven tool that converts static uploaded images into external URLs and matches them with product names.

In practical terms, the app currently:
- ingests product data from Excel or CSV
- accepts image files or folders from the browser
- matches images to products primarily from filenames and normalized metadata
- uploads matched images to Cloudinary
- exports updated files with external image URLs
- prepares Odoo-compatible base64 image columns when the export is clearly an Odoo update/import file

## Current status

What works today:
- Spreadsheet upload for `.xlsx`, `.xls`, and `.csv`
- File upload and folder upload from the browser
- Filename-first and metadata-first matching
- Match review and manual override
- Cloudinary hosting for matched images
- Export of updated workbook, CSV, and review report
- Odoo-aware export behavior for binary image fields such as `image_1920` and `product_variant_ids/image_1920`
- Python and TypeScript helper pipelines for Odoo image syncing

What is still being updated:
- Background removal is not yet finalized as a fully reliable end-to-end production flow
- In-app write-back of Odoo image updates is not yet wired directly into the main UI workflow
- Some Odoo update flows still need validation across more real-world import templates
- Base64 image updating is implemented in helpers and export logic, but still needs final end-to-end refinement in the main product flow

Important clarification:
- Odoo binary image fields require `base64`, not a plain URL
- If a file column is mapped to `image_1920` or `product_variant_ids/image_1920`, that column must contain raw base64 data
- A Cloudinary URL should only be used in URL-style columns, not in Odoo binary image fields
- The phrase "64 bit" in import discussions usually means `base64`

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-style UI primitives
- Supabase Postgres
- Cloudinary
- Zod
- `xlsx` for spreadsheet parsing/export
- `unzipper` for ZIP ingestion

## Implemented workflow

1. Upload `.xlsx`, `.xls`, or `.csv`.
2. Create a processing session and normalize spreadsheet rows.
3. Upload image libraries via browser file selection or folder upload.
4. Preserve and normalize relative paths.
5. Infer product, variation, SKU, extension, and path metadata from files.
6. Run deterministic matching in the order `sku_exact`, `product_variation_exact`, `product_exact`, then controlled fuzzy review.
7. Upload original images to Cloudinary.
8. Assign original Cloudinary delivery URLs immediately so matching can finish fast.
9. Warm background image-processing derivatives asynchronously in the background.
10. Review matches and apply manual overrides.
11. Export updated `.xlsx`, `.csv`, and a review report.
12. When the sheet looks like an Odoo update/import file, fill Odoo binary image columns with base64 instead of URLs.

## Project structure

```txt
src/
  app/
  components/
  lib/
  types/
supabase/
  migrations/
samples/
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_READ_TIMEOUT_MS=15000
MAX_UPLOAD_MB=100
MAX_IMAGES_PER_UPLOAD=500
CLOUDINARY_UPLOAD_FOLDER=product-image-automation
ASSET_JOB_BATCH_SIZE=4
ASSET_JOB_MAX_ATTEMPTS=4
```

## Local setup

1. Install dependencies.

```bash
npm install
```

2. Run the Supabase migration.

```bash
supabase db push
```

3. Optionally load the sample seed.

```bash
supabase db reset --seed
```

4. Start the app.

```bash
npm run dev
```

## API endpoints

- `POST /api/upload-sheet`
- `POST /api/upload-images/folder`
- `POST /api/upload-images/zip`
- `POST /api/process-session`
- `GET /api/session/:id`
- `DELETE /api/session/:id`
- `GET /api/session/:id/matches`
- `POST /api/session/:id/rematch`
- `POST /api/session/:id/override`
- `POST /api/session/:id/asset-processing`
- `POST /api/session/:id/export`

## Odoo image sync

- TypeScript helpers for Odoo-safe image preparation and batch `product.template` sync live in `src/lib/odoo/image-pipeline.ts`.
- The standalone Python batch script lives in `scripts/odoo_image_pipeline.py`.
- Install Python dependencies with `pip install -r scripts/requirements-odoo-sync.txt`.
- The Python script supports `--dry-run`, writes failed image URLs to JSON, and sends `image_1920` as base64 when syncing existing products through the Odoo API.
- The exporter now detects Odoo-style binary image headers and writes base64 into those fields.
- Odoo export/update detection currently treats `id`, `External ID`, and similar aliases as update identifiers.
- New-product imports may still use external URLs in some Odoo flows, but existing-product image updates should use base64 for binary image fields.

## Notes

- Browser uploads accept either multiple image files or an entire folder.
- Folder uploads rely on browser relative paths via `webkitRelativePath`.
- ZIP ingestion still normalizes entries into the same internal object shape when the archive endpoint is used.
- Matching now runs from filenames and normalized metadata only; it does not wait for image downloads.
- Original Cloudinary URLs are assigned immediately, while processed image variants are prepared in retriable background jobs.
- Spreadsheet exports preserve original columns and append or update the configured image URL column.
- If an export contains Odoo binary image headers, those fields are populated with base64 rather than Cloudinary URLs.
- If an Odoo file contains an update identifier but no binary image header yet, the exporter can append `image_1920`.
- Matching is intentionally decoupled from heavy image processing so the UI stays responsive.
- The current implementation uses a lightweight DB-backed background job flow triggered from the session UI. For larger production batches, move asset processing into a dedicated worker or queue service.
- Sample SVG assets are included to test folder structure and matching flow. For production-quality Cloudinary background removal, use raster product images.

## Known limitations

- Background removal still needs final production hardening.
- Odoo import success depends on mapping the correct export column to the correct Odoo field.
- If a user maps a URL column to an Odoo binary image field, Odoo will reject it with an "Image is not encoded in base64" style error.
- Large image batches will work best with a dedicated background worker instead of the current UI-triggered queue pattern.

## Suggested usage

1. Upload the spreadsheet.
2. Upload image files or a folder.
3. Let the app match products to images using filenames and metadata.
4. Review any low-confidence rows.
5. Export the updated file.
6. For Odoo updates, import the base64 image column into `image_1920` or `product_variant_ids/image_1920`, not the external URL column.

## Testing checklist

- Valid CSV, XLSX, and XLS uploads
- Missing product-name column
- Duplicate SKUs
- Multiple image file uploads
- Nested folder uploads
- ZIP uploads with non-image files
- Duplicate exact matches
- Manual overrides
- XLSX, CSV, and review report export downloads
