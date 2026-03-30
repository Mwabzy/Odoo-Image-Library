create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'ready', 'processing', 'completed', 'failed')),
  sheet_filename text,
  sheet_storage_path text,
  upload_mode text check (upload_mode in ('folder', 'zip')),
  path_mode text not null default 'auto' check (path_mode in ('auto', 'folder-product-variation', 'folder-product-only')),
  total_rows integer not null default 0,
  total_images integer not null default 0,
  matched_count integer not null default 0,
  needs_review_count integer not null default 0,
  unmatched_count integer not null default 0,
  error_message text,
  headers jsonb not null default '[]'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb
);

create table if not exists public.sheet_rows (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  row_index integer not null,
  product_name text,
  sku text,
  variation text,
  color text,
  size text,
  parent_sku text,
  raw_json jsonb not null default '{}'::jsonb,
  final_image_url text,
  status text not null default 'pending' check (status in ('pending', 'matched', 'needs_review', 'unmatched', 'duplicate_conflict'))
);

create table if not exists public.extracted_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  original_name text not null,
  relative_path text not null,
  normalized_path text not null,
  extension text not null,
  mime_type text not null,
  bytes bigint not null default 0,
  inferred_product text,
  inferred_variation text,
  inferred_sku text,
  cloudinary_public_id text,
  cloudinary_url text,
  processed_url text,
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'matched', 'needs_review', 'unmatched', 'duplicate_conflict', 'processing_failed'))
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  sheet_row_id uuid not null references public.sheet_rows(id) on delete cascade,
  image_id uuid references public.extracted_images(id) on delete cascade,
  confidence_score numeric(4, 2),
  match_reason text,
  matched_by text not null,
  status text not null check (status in ('matched', 'needs_review', 'unmatched', 'duplicate_conflict')),
  is_manual boolean not null default false
);

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  export_type text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.processing_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  stage text not null,
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sheet_rows_session_id on public.sheet_rows(session_id);
create index if not exists idx_sheet_rows_sku on public.sheet_rows(session_id, sku);
create index if not exists idx_extracted_images_session_id on public.extracted_images(session_id);
create index if not exists idx_extracted_images_sku on public.extracted_images(session_id, inferred_sku);
create index if not exists idx_matches_session_id on public.matches(session_id);
create index if not exists idx_matches_sheet_row_id on public.matches(sheet_row_id);
create index if not exists idx_processing_logs_session_id on public.processing_logs(session_id);
