-- Add plan_execution_id column to plans table
alter table public.plans
add column if not exists plan_execution_id uuid;

comment on column public.plans.plan_execution_id is
  'Optional link to the plan_executions table used by schedule-from-readiness.';