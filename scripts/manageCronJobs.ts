/**
 * Manage Cron Jobs for Cache Refresh
 * 
 * Usage:
 * - View active jobs: deno run --allow-net --allow-env scripts/manageCronJobs.ts list
 * - Delete test job: deno run --allow-net --allow-env scripts/manageCronJobs.ts delete-test
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://jpcrphdevmvzcfgokgym.supabase.co';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const command = Deno.args[0];

async function listJobs() {
  const { data, error } = await supabase.rpc('query_cron_jobs' as any, {
    query: 'SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobid'
  });
  
  if (error) {
    console.error('❌ Error listing jobs:', error);
    return;
  }
  
  console.log('\n📋 Active Cron Jobs:\n');
  console.table(data);
}

async function deleteTestJob() {
  const { data, error } = await supabase.rpc('delete_cron_job' as any, {
    query: "SELECT cron.unschedule('test-cache-refresh-every-minute')"
  });
  
  if (error) {
    console.error('❌ Error deleting test job:', error);
    return;
  }
  
  console.log('✅ Test job deleted successfully');
  console.log('ℹ️  The nightly job (2 AM UTC) is still active');
}

switch (command) {
  case 'list':
    await listJobs();
    break;
  case 'delete-test':
    await deleteTestJob();
    break;
  default:
    console.log(`
📚 Cron Job Management

Commands:
  list         - List all active cron jobs
  delete-test  - Delete the test job (keep nightly job)

Examples:
  deno run --allow-net --allow-env scripts/manageCronJobs.ts list
  deno run --allow-net --allow-env scripts/manageCronJobs.ts delete-test
    `);
}
