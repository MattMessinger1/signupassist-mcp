/**
 * Cache Population Test Edge Function
 * 
 * This function tests the database cache infrastructure by:
 * 1. Generating mock program data
 * 2. Upserting to the cached_programs table
 * 3. Reading back from the cache
 * 4. Verifying the cache works end-to-end
 * 
 * Use this to test cache functionality before setting up the real scraper.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mock program data for testing
const MOCK_PROGRAMS_BY_THEME = {
  "Lessons & Classes": [
    {
      program_id: "test-lesson-1",
      title: "Beginner Ski Lessons",
      brief: "Perfect for first-time skiers",
      age_range: "6-12",
      schedule: "Saturdays 9AM-12PM",
      price: "$299",
      status: "open",
      cta_label: "Register",
      cta_href: null
    },
    {
      program_id: "test-lesson-2",
      title: "Intermediate Snowboard",
      brief: "Level up your riding",
      age_range: "10-16",
      schedule: "Sundays 1PM-4PM",
      price: "$349",
      status: "open",
      cta_label: "Register",
      cta_href: null
    }
  ],
  "Race Team & Events": [
    {
      program_id: "test-race-1",
      title: "Junior Race Team",
      brief: "Competitive ski racing program",
      age_range: "8-14",
      schedule: "Wednesdays & Saturdays",
      price: "$599",
      status: "waitlist",
      cta_label: "Join Waitlist",
      cta_href: null
    }
  ]
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[test-cache-population] Starting cache test...');
  
  // Initialize Supabase client with service role
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const testResults: any[] = [];

  try {
    // Test 1: Upsert mock programs to cache
    console.log('[test-cache-population] Test 1: Upserting mock programs...');
    const { data: cacheId, error: upsertError } = await supabase.rpc('upsert_cached_programs', {
      p_org_ref: 'blackhawk-ski',
      p_category: 'lessons',
      p_programs_by_theme: MOCK_PROGRAMS_BY_THEME,
      p_metadata: {
        scrape_type: 'test_data',
        program_count: 3,
        themes: ['Lessons & Classes', 'Race Team & Events'],
        test_run_at: new Date().toISOString()
      },
      p_ttl_hours: 24
    });

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    testResults.push({
      test: 'upsert_cached_programs',
      success: true,
      cache_id: cacheId,
      message: `Successfully cached 3 test programs`
    });

    console.log(`[test-cache-population] ✅ Upsert successful, cache_id: ${cacheId}`);

    // Test 2: Read from cache
    console.log('[test-cache-population] Test 2: Reading from cache...');
    const { data: cachedData, error: readError } = await supabase.rpc('find_programs_cached', {
      p_org_ref: 'blackhawk-ski',
      p_category: 'lessons',
      p_max_age_hours: 24
    });

    if (readError) {
      throw new Error(`Read failed: ${readError.message}`);
    }

    const isValidCache = cachedData && Object.keys(cachedData).length > 0;
    const programCount = isValidCache ? Object.values(cachedData).flat().length : 0;

    testResults.push({
      test: 'find_programs_cached',
      success: isValidCache,
      program_count: programCount,
      themes: isValidCache ? Object.keys(cachedData) : [],
      message: isValidCache ? `Retrieved ${programCount} programs from cache` : 'Cache miss'
    });

    console.log(`[test-cache-population] ${isValidCache ? '✅' : '❌'} Cache read: ${programCount} programs`);

    // Test 3: Verify cache contents match what we inserted
    console.log('[test-cache-population] Test 3: Verifying cache contents...');
    const contentsMatch = JSON.stringify(cachedData) === JSON.stringify(MOCK_PROGRAMS_BY_THEME);

    testResults.push({
      test: 'verify_cache_contents',
      success: contentsMatch,
      message: contentsMatch ? 'Cache contents match inserted data' : 'Cache contents differ from inserted data'
    });

    console.log(`[test-cache-population] ${contentsMatch ? '✅' : '❌'} Contents verification`);

    // Test 4: Query cached_programs table directly
    console.log('[test-cache-population] Test 4: Direct table query...');
    const { data: tableData, error: tableError } = await supabase
      .from('cached_programs')
      .select('id, org_ref, category, cached_at, expires_at, metadata')
      .eq('org_ref', 'blackhawk-ski')
      .eq('category', 'lessons')
      .order('cached_at', { ascending: false })
      .limit(1);

    if (tableError) {
      throw new Error(`Table query failed: ${tableError.message}`);
    }

    testResults.push({
      test: 'direct_table_query',
      success: !!tableData && tableData.length > 0,
      table_data: tableData?.[0],
      message: tableData?.length ? 'Found cache entry in table' : 'No cache entry found'
    });

    console.log(`[test-cache-population] ${tableData?.length ? '✅' : '❌'} Table query`);

    const summary = {
      timestamp: new Date().toISOString(),
      overall_success: testResults.every(t => t.success),
      tests_run: testResults.length,
      tests_passed: testResults.filter(t => t.success).length,
      test_results: testResults
    };

    console.log(`[test-cache-population] 🏁 Complete: ${summary.tests_passed}/${summary.tests_run} tests passed`);

    return new Response(JSON.stringify(summary, null, 2), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[test-cache-population] ❌ Error: ${error.message}`);
    
    return new Response(JSON.stringify({
      error: error.message,
      test_results: testResults
    }, null, 2), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
