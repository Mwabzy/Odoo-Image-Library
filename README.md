# Product Image Automation

Production-oriented Next.js App Router starter for spreadsheet-driven product image matching, Cloudinary background removal, Supabase-backed session tracking, and export generation.

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
9. Warm slow background-removal derivatives asynchronously in the background.
10. Review matches and apply manual overrides.
11. Export updated `.xlsx`, `.csv`, and a review report.

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

## Notes

- Browser uploads accept either multiple image files or an entire folder.
- Folder uploads rely on browser relative paths via `webkitRelativePath`.
- ZIP ingestion still normalizes entries into the same internal object shape when the archive endpoint is used.
- Matching now runs from filenames and normalized metadata only; it does not wait for image downloads.
- Original Cloudinary URLs are assigned immediately, while background-removal URLs are prepared in retriable background jobs.
- Spreadsheet exports preserve original columns and append or update the configured image URL column.
- The current implementation uses a lightweight DB-backed background job flow triggered from the session UI. For larger production batches, move asset processing into a dedicated worker or queue service.
- Sample SVG assets are included to test folder structure and matching flow. For production-quality Cloudinary background removal, use raster product images.

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
