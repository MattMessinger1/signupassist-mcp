/**
 * Test script for cache population
 * 
 * Usage: bun run scripts/testCachePopulation.ts
 * 
 * Tests the populate-program-cache edge function with sample data
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://jpcrphdevmvzcfgokgym.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// Sample program data
const samplePrograms = [
  {
    program_ref: 'beginner-alpine',
    title: 'Beginner Alpine Skiing',
    dates: 'Jan 15 - Mar 15, 2025',
    schedule_text: 'Sundays 9:00 AM - 3:00 PM',
    age_range: '6-12',
    age_min: 6,
    age_max: 12,
    price: '$450',
    status: 'open',
    theme: 'alpine'
  },
  {
    program_ref: 'intermediate-alpine',
    title: 'Intermediate Alpine Skiing',
    dates: 'Jan 15 - Mar 15, 2025',
    schedule_text: 'Sundays 9:00 AM - 3:00 PM',
    age_range: '8-14',
    age_min: 8,
    age_max: 14,
    price: '$475',
    status: 'open',
    theme: 'alpine'
  },
  {
    program_ref: 'wednesday-nordic-kids',
    title: 'Wednesday Nordic Kids',
    dates: 'Jan 10 - Mar 10, 2025',
    schedule_text: 'Wednesdays 4:00 PM - 6:00 PM',
    age_range: '7-13',
    age_min: 7,
    age_max: 13,
    price: '$350',
    status: 'open',
    theme: 'nordic'
  },
  {
    program_ref: 'racing-team',
    title: 'Racing Team',
    dates: 'Dec 1, 2024 - Mar 31, 2025',
    schedule_text: 'Saturdays 8:00 AM - 4:00 PM',
    age_range: '10-18',
    age_min: 10,
    age_max: 18,
    price: '$850',
    status: 'waitlist',
    theme: 'racing'
  }
];

async function testCachePopulation() {
  console.log('🚀 Testing cache population...\n');

  try {
    // Call the populate-program-cache edge function
    const { data, error } = await supabase.functions.invoke('populate-program-cache', {
      body: {
        org_ref: 'blackhawk-ski',
        category: 'all',
        programs: samplePrograms,
        ttl_hours: 24
      }
    });

    if (error) {
      console.error('❌ Error calling edge function:', error);
      return;
    }

    console.log('✅ Cache population successful!');
    console.log('\nResponse:', JSON.stringify(data, null, 2));

    // Test reading the cache
    console.log('\n📖 Testing cache retrieval...\n');

    const { data: cacheData, error: cacheError } = await supabase.rpc('find_programs_cached', {
      p_org_ref: 'blackhawk-ski',
      p_category: 'all',
      p_max_age_hours: 24
    });

    if (cacheError) {
      console.error('❌ Error reading cache:', cacheError);
      return;
    }

    if (!cacheData || Object.keys(cacheData).length === 0) {
      console.log('⚠️  No cache data found');
      return;
    }

    console.log('✅ Cache retrieved successfully!');
    console.log('\n📊 Cache structure:');
    console.log('- Programs by theme:', Object.keys(cacheData));
    
    // Sample one program from cache to show structure
    const firstTheme = Object.keys(cacheData)[0];
    if (firstTheme && cacheData[firstTheme]) {
      console.log(`\n📝 Sample program from "${firstTheme}" theme:`);
      console.log(JSON.stringify(cacheData[firstTheme][0], null, 2));
    }

    // Direct query to see full cache entry with new fields
    console.log('\n🔍 Querying cached_programs table directly...\n');
    
    const { data: fullCache, error: fullError } = await supabase
      .from('cached_programs')
      .select('*')
      .eq('org_ref', 'blackhawk-ski')
      .eq('category', 'all')
      .order('cached_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fullError) {
      console.error('❌ Error querying cache table:', fullError);
      return;
    }

    if (!fullCache) {
      console.log('⚠️  No cache entry found in table');
      return;
    }

    console.log('✅ Full cache entry retrieved!');
    console.log('\n📋 Prerequisites schema keys:', Object.keys(fullCache.prerequisites_schema || {}));
    console.log('📋 Questions schema keys:', Object.keys(fullCache.questions_schema || {}));
    console.log('📋 Deep links keys:', Object.keys(fullCache.deep_links || {}));

    // Show sample prerequisite
    const firstProgramRef = Object.keys(fullCache.prerequisites_schema || {})[0];
    if (firstProgramRef) {
      console.log(`\n📝 Prerequisites for "${firstProgramRef}":`);
      console.log(JSON.stringify(fullCache.prerequisites_schema[firstProgramRef], null, 2));
      
      console.log(`\n📝 Questions for "${firstProgramRef}":`);
      console.log(JSON.stringify(fullCache.questions_schema[firstProgramRef], null, 2));
      
      console.log(`\n📝 Deep links for "${firstProgramRef}":`);
      console.log(JSON.stringify(fullCache.deep_links[firstProgramRef], null, 2));
    }

    console.log('\n✅ All tests passed!');

  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
}

// Run the test
testCachePopulation().catch(console.error);
