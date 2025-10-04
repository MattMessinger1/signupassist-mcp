import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Schema consistency validation result
 */
export interface ValidationResult {
  valid: boolean;
  mismatches: Array<{
    table: string;
    column: string;
    expected: string;
    actual: string;
    severity: 'error' | 'warning';
  }>;
  warnings: string[];
  timestamp: string;
}

/**
 * Expected schema definitions for consistency
 */
const EXPECTED_COLUMNS = {
  plans: {
    id: 'uuid',
    user_id: 'uuid',
    child_id: 'uuid',
    mandate_id: 'uuid',
    plan_execution_id: 'uuid',
  },
  plan_executions: {
    id: 'uuid',
    plan_id: 'uuid',
  },
  children: {
    id: 'uuid',
    user_id: 'uuid',
  },
  stored_credentials: {
    id: 'uuid',
    user_id: 'uuid',
  },
  mandates: {
    id: 'uuid',
    user_id: 'uuid',
    child_id: 'uuid',
  },
  browser_sessions: {
    id: 'uuid',
  },
  audit_events: {
    id: 'uuid',
    user_id: 'uuid',
    mandate_id: 'uuid',
    plan_id: 'uuid',
    plan_execution_id: 'uuid',
  },
  execution_logs: {
    id: 'uuid',
    correlation_id: 'uuid',
    plan_id: 'uuid',
    plan_execution_id: 'uuid',
    mandate_id: 'uuid',
  },
  evidence_assets: {
    id: 'uuid',
    plan_execution_id: 'uuid',
  },
  charges: {
    id: 'uuid',
    plan_execution_id: 'uuid',
  },
};

/**
 * Foreign key relationships that should exist
 */
const EXPECTED_FOREIGN_KEYS = [
  { table: 'plans', column: 'user_id', references: 'auth.users(id)' },
  { table: 'plans', column: 'child_id', references: 'children(id)' },
  { table: 'plans', column: 'mandate_id', references: 'mandates(id)' },
  { table: 'plan_executions', column: 'plan_id', references: 'plans(id)' },
  { table: 'children', column: 'user_id', references: 'auth.users(id)' },
  { table: 'stored_credentials', column: 'user_id', references: 'auth.users(id)' },
  { table: 'mandates', column: 'user_id', references: 'auth.users(id)' },
  { table: 'mandates', column: 'child_id', references: 'children(id)' },
  { table: 'execution_logs', column: 'plan_id', references: 'plans(id)' },
  { table: 'execution_logs', column: 'plan_execution_id', references: 'plan_executions(id)' },
  { table: 'execution_logs', column: 'mandate_id', references: 'mandates(id)' },
];

/**
 * Query column information from PostgreSQL information_schema
 */
async function getTableColumns(
  supabase: SupabaseClient,
  tableName: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('get_table_columns', {
    p_table_name: tableName,
    p_schema_name: 'public'
  });

  if (error) {
    console.warn(`Failed to query columns for ${tableName}:`, error.message);
    return new Map();
  }

  const columnMap = new Map<string, string>();
  
  if (data && Array.isArray(data)) {
    for (const row of data) {
      columnMap.set(row.column_name, row.data_type);
    }
  }

  return columnMap;
}

/**
 * Validate schema consistency across tables
 */
export async function validateSchemaConsistency(
  supabaseUrl?: string,
  supabaseKey?: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    mismatches: [],
    warnings: [],
    timestamp: new Date().toISOString(),
  };

  try {
    // Create Supabase client
    const supabase = createClient(
      supabaseUrl || Deno.env.get('SUPABASE_URL') || '',
      supabaseKey || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // First, create the helper RPC function if it doesn't exist
    await createHelperFunction(supabase);

    console.log('[SchemaValidation] Starting schema consistency check...');

    // Check each table's columns
    for (const [tableName, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
      console.log(`[SchemaValidation] Checking table: ${tableName}`);
      
      const actualColumns = await getTableColumns(supabase, tableName);
      
      if (actualColumns.size === 0) {
        result.warnings.push(`Table '${tableName}' not found or inaccessible`);
        continue;
      }

      // Validate expected columns
      for (const [columnName, expectedType] of Object.entries(expectedColumns)) {
        const actualType = actualColumns.get(columnName);
        
        if (!actualType) {
          result.mismatches.push({
            table: tableName,
            column: columnName,
            expected: expectedType,
            actual: 'missing',
            severity: 'error',
          });
          result.valid = false;
          console.warn(
            `[SchemaValidation] ❌ ${tableName}.${columnName}: expected ${expectedType}, but column is missing`
          );
        } else if (actualType !== expectedType) {
          result.mismatches.push({
            table: tableName,
            column: columnName,
            expected: expectedType,
            actual: actualType,
            severity: 'error',
          });
          result.valid = false;
          console.warn(
            `[SchemaValidation] ❌ ${tableName}.${columnName}: expected ${expectedType}, got ${actualType}`
          );
        }
      }
    }

    // Validate foreign key naming consistency
    const fkInconsistencies = validateForeignKeyNaming();
    if (fkInconsistencies.length > 0) {
      result.warnings.push(...fkInconsistencies);
      console.warn(`[SchemaValidation] ⚠️ Foreign key naming inconsistencies:`, fkInconsistencies);
    }

    if (result.valid && result.warnings.length === 0) {
      console.log('[SchemaValidation] ✅ Schema validation passed - all tables consistent');
    } else if (result.valid) {
      console.log('[SchemaValidation] ⚠️ Schema validation passed with warnings');
    } else {
      console.error('[SchemaValidation] ❌ Schema validation failed - see mismatches above');
    }

  } catch (error) {
    console.error('[SchemaValidation] Validation error:', error);
    result.valid = false;
    result.warnings.push(
      `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  return result;
}

/**
 * Create helper RPC function for querying schema
 */
async function createHelperFunction(supabase: SupabaseClient): Promise<void> {
  const createFunctionSQL = `
    CREATE OR REPLACE FUNCTION get_table_columns(
      p_table_name TEXT,
      p_schema_name TEXT DEFAULT 'public'
    )
    RETURNS TABLE (
      column_name TEXT,
      data_type TEXT
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT 
        column_name::TEXT,
        data_type::TEXT
      FROM information_schema.columns
      WHERE table_schema = p_schema_name
        AND table_name = p_table_name
      ORDER BY ordinal_position;
    $$;
  `;

  try {
    // Execute raw SQL via RPC (this assumes we have permission)
    // In production, this function should be created via migration
    await supabase.rpc('exec_sql', { sql: createFunctionSQL }).catch(() => {
      // Function might already exist or we might not have permission
      // This is OK - the function should exist from migrations
    });
  } catch {
    // Ignore - function should exist from migration
  }
}

/**
 * Validate foreign key naming consistency
 */
function validateForeignKeyNaming(): string[] {
  const inconsistencies: string[] = [];

  // Check for common naming patterns
  const idColumns = new Set<string>();
  
  for (const [tableName, columns] of Object.entries(EXPECTED_COLUMNS)) {
    for (const columnName of Object.keys(columns)) {
      if (columnName.endsWith('_id')) {
        idColumns.add(columnName);
      }
    }
  }

  // Check for inconsistent naming (e.g., account_id vs user_id)
  if (idColumns.has('account_id') && idColumns.has('user_id')) {
    inconsistencies.push(
      'Inconsistent naming: both account_id and user_id found. Use user_id consistently.'
    );
  }

  return inconsistencies;
}

/**
 * Get validation result as HTTP response headers
 */
export function getValidationHeaders(result: ValidationResult): Record<string, string> {
  return {
    'X-Schema-Valid': String(result.valid),
    'X-Schema-Warnings': String(result.warnings.length + result.mismatches.length),
    'X-Schema-Validated-At': result.timestamp,
  };
}
