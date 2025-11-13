/**
 * Test Script for Authenticated Cache Warming (Phase 3)
 * 
 * This script tests the warm-cache-authenticated edge function
 * which uses the system mandate and credentials to populate the cache.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

async function testCacheWarming() {
  console.log('🧪 Testing Authenticated Cache Warming (Phase 3)');
  console.log('='.repeat(60));

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Test 1: Warm cache for specific org and category
  console.log('\n[Test 1] Warming cache for blackhawk-ski-club:lessons');
  try {
    const { data, error } = await supabase.functions.invoke('warm-cache-authenticated', {
      body: {
        org_ref: 'blackhawk-ski-club',
        category: 'lessons',
        force_refresh: true
      }
    });

    if (error) {
      console.error('❌ Error:', error);
    } else {
      console.log('✅ Success:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('❌ Exception:', err);
  }

  // Test 2: Warm cache for all configured orgs (default behavior)
  console.log('\n[Test 2] Warming cache for all configured orgs');
  try {
    const { data, error } = await supabase.functions.invoke('warm-cache-authenticated', {
      body: {}
    });

    if (error) {
      console.error('❌ Error:', error);
    } else {
      console.log('✅ Success:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('❌ Exception:', err);
  }

  // Test 3: Check mandate_audit table for logged operations
  console.log('\n[Test 3] Checking mandate_audit for recent cache warming operations');
  try {
    const { data: auditLogs, error: auditError } = await supabase
      .from('mandate_audit')
      .select('*')
      .eq('action', 'cache_warm_start')
      .order('created_at', { ascending: false })
      .limit(5);

    if (auditError) {
      console.error('❌ Error fetching audit logs:', auditError);
    } else {
      console.log('✅ Recent cache warming operations:');
      console.log(JSON.stringify(auditLogs, null, 2));
    }
  } catch (err) {
    console.error('❌ Exception:', err);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Cache warming tests complete!');
}

testCacheWarming().catch(console.error);
