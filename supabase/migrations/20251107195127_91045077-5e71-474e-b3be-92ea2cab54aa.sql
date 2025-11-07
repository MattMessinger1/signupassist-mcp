-- Create table to store user answers server-side for OAuth 2.1 compliance
create table if not exists public.user_prereq_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_ref text not null,
  program_ref text not null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_program unique (user_id, org_ref, program_ref)
);

-- Enable RLS
alter table public.user_prereq_answers enable row level security;

-- RLS Policy: Users can manage their own answers
create policy "Users can manage their own prereq answers"
on public.user_prereq_answers
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Index for fast lookups by user and program
create index idx_user_prereq_answers_user_program 
on public.user_prereq_answers(user_id, org_ref, program_ref);

-- Index for lookups by org_ref (for cache invalidation)
create index idx_user_prereq_answers_org_ref
on public.user_prereq_answers(org_ref);

-- Trigger to automatically update updated_at timestamp
create trigger set_user_prereq_answers_updated_at
before update on public.user_prereq_answers
for each row
execute function public.update_updated_at_column();

-- Add comment for documentation
comment on table public.user_prereq_answers is 'Stores user responses to program prerequisites and questions server-side for OAuth 2.1 compliance. Linked to mandate_audit for audit trail.';