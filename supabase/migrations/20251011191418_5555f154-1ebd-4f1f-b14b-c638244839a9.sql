-- This helper restores the function required by schedule-from-readiness
-- It allows the Edge Function to query column metadata for any table.

CREATE OR REPLACE FUNCTION public.get_table_columns(
  p_schema_name text,
  p_table_name text
)
RETURNS TABLE(column_name text, data_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT column_name::text, data_type::text
  FROM information_schema.columns
  WHERE table_schema = p_schema_name
    AND table_name = p_table_name;
$$;

COMMENT ON FUNCTION public.get_table_columns IS
  'Returns column metadata (name, type) for a given schema and table.';