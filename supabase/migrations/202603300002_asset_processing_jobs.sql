create table if not exists public.asset_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  image_id uuid not null references public.extracted_images(id) on delete cascade,
  cloudinary_public_id text not null,
  delivery_url text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 4,
  last_error text,
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_asset_processing_jobs_image_id
  on public.asset_processing_jobs(image_id);

create index if not exists idx_asset_processing_jobs_session_status
  on public.asset_processing_jobs(session_id, status, scheduled_at);
