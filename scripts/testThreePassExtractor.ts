/**
 * Direct Three-Pass Extractor Test
 * Bypasses login, uses existing session, focuses on extraction only
 * 
 * Usage: npx tsx scripts/testThreePassExtractor.ts
 */

import 'dotenv/config';
import { chromium } from 'playwright-core';
import { createStealthContext } from '../mcp_server/lib/antibot.js';
import { runThreePassExtractor } from '../mcp_server/lib/threePassExtractor.js';
import { createClient } from '@supabase/supabase-js';

const ORG_REF = 'blackhawk-ski';
const TEST_CREDENTIAL_ID = '02bf470b-7057-46dd-bab9-39b67f8272e7'; // From your logs

async function testExtractor() {
  console.log('🧪 Three-Pass Extractor Direct Test\n');
  
  // Step 1: Get existing credential to reuse session
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  console.log('[1/5] Fetching stored credential...');
  const { data: credData, error: credError } = await supabase
    .from('stored_credentials')
    .select('*')
    .eq('id', TEST_CREDENTIAL_ID)
    .single();
    
  if (credError || !credData) {
    throw new Error(`Failed to fetch credential: ${credError?.message}`);
  }
  console.log('✅ Credential found for:', credData.email);
  
  // Step 2: Launch Browserbase session
  console.log('\n[2/5] Launching Browserbase session...');
  const { data: sessionData, error: sessionError } = await supabase.functions.invoke('launch-browserbase', {
    body: { headless: true }
  });
  
  if (sessionError) {
    throw new Error(`Browserbase launch failed: ${sessionError.message}`);
  }
  
  const sessionId = sessionData.session.id;
  const connectUrl = sessionData.session.connectUrl;
  console.log(`✅ Session created: ${sessionId}`);
  console.log(`   View: https://www.browserbase.com/sessions/${sessionId}`);
  
  // Step 3: Connect Playwright
  console.log('\n[3/5] Connecting Playwright...');
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = await createStealthContext(browser, { forceEnable: true });
  const page = await context.newPage();
  console.log('✅ Connected to Browserbase');
  
  try {
    // Step 4: Navigate with stored cookies
    console.log('\n[4/5] Navigating to registration page...');
    
    // Add cookies from stored credential (if available)
    if (credData.cookies && Array.isArray(credData.cookies)) {
      await context.addCookies(credData.cookies);
      console.log(`✅ Added ${credData.cookies.length} stored cookies`);
    }
    
    const registrationUrl = `https://${ORG_REF}.skiclubpro.team/registration`;
    await page.goto(registrationUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log(`✅ Navigated to: ${page.url()}`);
    
    // Quick login check (non-blocking)
    const logoutLink = await page.locator('a:has-text("Log out")').count();
    if (logoutLink > 0) {
      console.log('✅ Authenticated (logout link found)');
    } else {
      console.warn('⚠️  May not be logged in, but proceeding anyway...');
    }
    
    // Step 5: Run Three-Pass Extractor
    console.log('\n[5/5] Running Three-Pass Extractor...\n');
    console.log('═'.repeat(60));
    
    const programs = await runThreePassExtractor(page, ORG_REF, 'skiclubpro');
    
    console.log('═'.repeat(60));
    console.log(`\n✅ Extraction complete! Found ${programs.length} programs\n`);
    
    if (programs.length > 0) {
      console.log('📋 Extracted Programs:\n');
      programs.forEach((prog, i) => {
        console.log(`${i + 1}. ${prog.title}`);
        console.log(`   ID: ${prog.id}`);
        console.log(`   Price: ${prog.price}`);
        console.log(`   Schedule: ${prog.schedule}`);
        console.log(`   Ages: ${prog.age_range}`);
        console.log(`   Level: ${prog.skill_level}`);
        console.log(`   Status: ${prog.status}`);
        console.log(`   Description: ${prog.description?.substring(0, 100)}...`);
        console.log('');
      });
      
      // Show summary
      console.log('\n📊 Summary:');
      console.log(`   Total programs: ${programs.length}`);
      console.log(`   With prices: ${programs.filter(p => p.price && p.price !== 'TBD').length}`);
      console.log(`   With schedules: ${programs.filter(p => p.schedule).length}`);
      console.log(`   With age ranges: ${programs.filter(p => p.age_range).length}`);
      
    } else {
      console.warn('⚠️  No programs extracted - check extractor prompts or page content');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    // Capture screenshot on error
    try {
      const screenshot = await page.screenshot({ fullPage: true });
      console.log('\n📸 Screenshot captured on error (first 200 chars of base64):');
      console.log(screenshot.toString('base64').substring(0, 200) + '...');
    } catch (screenshotError) {
      console.error('Could not capture error screenshot:', screenshotError);
    }
    
    throw error;
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed');
  }
}

// Run the test
testExtractor().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
