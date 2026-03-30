create or replace function public.set_asset_processing_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_asset_processing_jobs_updated_at
on public.asset_processing_jobs;

create trigger trg_asset_processing_jobs_updated_at
before update on public.asset_processing_jobs
for each row
execute function public.set_asset_processing_jobs_updated_at();
