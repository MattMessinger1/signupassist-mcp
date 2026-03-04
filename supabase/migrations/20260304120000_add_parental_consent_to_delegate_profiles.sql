alter table public.delegate_profiles
  add column if not exists parental_consent boolean not null default false,
  add column if not exists parental_consent_at timestamptz;
