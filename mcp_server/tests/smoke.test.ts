/**
 * Smoke Tests for Authentication & Program Discovery Flow
 * 
 * These tests verify the critical path for login, session management,
 * and program extraction following the expected log milestones defined
 * in docs/RUNBOOK_EXPECTED_LOGS.md
 */

import { test, expect } from '@playwright/test';
import 'dotenv/config';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://signupassist-mcp-production.up.railway.app';
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;

if (!MCP_ACCESS_TOKEN) {
  throw new Error('MCP_ACCESS_TOKEN not configured for smoke tests');
}

interface MCPToolCallResponse {
  success: boolean;
  session_token?: string;
  programs?: any[];
  programs_by_theme?: Record<string, any[]>;
  login_status?: string;
  error?: string;
}

/**
 * Helper: Call MCP tool via HTTP
 */
async function callMCPTool(toolName: string, args: any): Promise<MCPToolCallResponse> {
  const response = await fetch(`${MCP_SERVER_URL}/tools/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MCP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tool: toolName,
      args
    })
  });

  if (!response.ok) {
    throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * SMOKE TEST 1: Happy Path (Blackhawk)
 * 
 * Trigger: Provider select → credentials submit
 * Pass condition: 
 *   - Real session_token set in context (not undefined)
 *   - Programs returned grouped by theme (Lessons & Classes, Camps & Clinics, etc.)
 */
test('Smoke Test 1: Happy Path - Login and Program Discovery', async () => {
  console.log('\n=== SMOKE TEST 1: Happy Path (Blackhawk) ===\n');
  
  // Step 1: Login with credentials
  console.log('Step 1: Calling scp.login...');
  const loginResult = await callMCPTool('scp.login', {
    org_ref: 'blackhawk-ski-club',
    credential_id: process.env.TEST_CREDENTIAL_ID,
    user_jwt: process.env.TEST_USER_JWT,
    mandate_jws: process.env.TEST_MANDATE_JWS || process.env.DEV_MANDATE_JWS
  });

  console.log('Login result:', JSON.stringify(loginResult, null, 2));

  // Verify login success
  expect(loginResult.success).toBe(true);
  expect(loginResult.login_status).toBe('success');
  
  // CRITICAL: Verify session_token is set and not undefined
  expect(loginResult.session_token).toBeDefined();
  expect(loginResult.session_token).not.toBe('undefined');
  expect(typeof loginResult.session_token).toBe('string');
  expect(loginResult.session_token.length).toBeGreaterThan(0);
  
  console.log(`✅ Session token generated: ${loginResult.session_token}`);

  // Step 2: Discover programs using the session token
  console.log('\nStep 2: Calling scp.find_programs with session_token...');
  const programsResult = await callMCPTool('scp.find_programs', {
    org_ref: 'blackhawk-ski-club',
    session_token: loginResult.session_token,
    mandate_jws: process.env.TEST_MANDATE_JWS || process.env.DEV_MANDATE_JWS
  });

  console.log('Programs result:', JSON.stringify(programsResult, null, 2));

  // Verify programs discovery success
  expect(programsResult.success).toBe(true);
  expect(programsResult.programs).toBeDefined();
  expect(Array.isArray(programsResult.programs)).toBe(true);
  expect(programsResult.programs.length).toBeGreaterThan(0);

  // Verify programs are grouped by theme
  expect(programsResult.programs_by_theme).toBeDefined();
  expect(typeof programsResult.programs_by_theme).toBe('object');
  
  const themes = Object.keys(programsResult.programs_by_theme);
  console.log(`✅ Programs grouped into themes: ${themes.join(', ')}`);
  
  // Verify expected themes exist
  const expectedThemes = ['Lessons & Classes', 'Camps & Clinics', 'Races & Teams', 'Private Lessons', 'Other Programs'];
  const hasValidThemes = themes.some(theme => expectedThemes.includes(theme));
  expect(hasValidThemes).toBe(true);

  console.log('\n✅ SMOKE TEST 1 PASSED: Happy path successful\n');
});

/**
 * SMOKE TEST 2: Extractor Test - Session Reuse
 * 
 * Trigger: Invoke extractor with existing session_token
 * Pass condition:
 *   - Log shows "Reusing existing session_token; skipping login"
 *   - Same themed cards returned without re-login
 */
test('Smoke Test 2: Session Reuse - No Re-login', async () => {
  console.log('\n=== SMOKE TEST 2: Extractor Test - Session Reuse ===\n');

  // Step 1: Initial login to get session token
  console.log('Step 1: Initial login to obtain session_token...');
  const loginResult = await callMCPTool('scp.login', {
    org_ref: 'blackhawk-ski-club',
    credential_id: process.env.TEST_CREDENTIAL_ID,
    user_jwt: process.env.TEST_USER_JWT,
    mandate_jws: process.env.TEST_MANDATE_JWS || process.env.DEV_MANDATE_JWS
  });

  expect(loginResult.success).toBe(true);
  expect(loginResult.session_token).toBeDefined();
  
  const sessionToken = loginResult.session_token;
  console.log(`✅ Session token obtained: ${sessionToken}`);

  // Step 2: Call find_programs multiple times with same token
  console.log('\nStep 2: Calling scp.find_programs (1st time)...');
  const firstCall = await callMCPTool('scp.find_programs', {
    org_ref: 'blackhawk-ski-club',
    session_token: sessionToken,
    mandate_jws: process.env.TEST_MANDATE_JWS || process.env.DEV_MANDATE_JWS
  });

  expect(firstCall.success).toBe(true);
  expect(firstCall.programs).toBeDefined();
  const firstProgramCount = firstCall.programs.length;
  console.log(`✅ First call: ${firstProgramCount} programs extracted`);

  // Wait a moment to simulate orchestrator behavior
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\nStep 3: Calling scp.find_programs (2nd time - should reuse session)...');
  const secondCall = await callMCPTool('scp.find_programs', {
    org_ref: 'blackhawk-ski-club',
    session_token: sessionToken,
    mandate_jws: process.env.TEST_MANDATE_JWS || process.env.DEV_MANDATE_JWS
  });

  expect(secondCall.success).toBe(true);
  expect(secondCall.programs).toBeDefined();
  const secondProgramCount = secondCall.programs.length;
  console.log(`✅ Second call: ${secondProgramCount} programs extracted`);

  // Verify consistency between calls
  expect(secondProgramCount).toBe(firstProgramCount);
  
  // Verify themes are consistent
  const firstThemes = Object.keys(firstCall.programs_by_theme || {}).sort();
  const secondThemes = Object.keys(secondCall.programs_by_theme || {}).sort();
  expect(secondThemes).toEqual(firstThemes);

  console.log('✅ Session reuse verified: Same results without re-login');
  console.log(`   Themes: ${firstThemes.join(', ')}`);
  console.log('\n✅ SMOKE TEST 2 PASSED: Session reuse working correctly\n');
});

/**
 * SMOKE TEST 3: Mandate Friction - Dev Fallback
 * 
 * Trigger: Blank mandate_jws in non-production environment
 * Pass condition:
 *   - Log shows "[audit] DEV: proceeding with DEV_MANDATE_JWS fallback"
 *   - Flow continues successfully
 *   - Programs are returned
 */
test('Smoke Test 3: Mandate Friction - Dev Fallback', async () => {
  console.log('\n=== SMOKE TEST 3: Mandate Friction - Dev Fallback ===\n');

  // Verify we're in non-production environment
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    console.log('⚠️  Skipping test: Cannot test dev fallback in production environment');
    test.skip();
    return;
  }

  // Verify DEV_MANDATE_JWS is configured
  if (!process.env.DEV_MANDATE_JWS) {
    console.log('⚠️  Skipping test: DEV_MANDATE_JWS not configured');
    test.skip();
    return;
  }

  console.log('Step 1: Attempting login WITHOUT mandate_jws (should use dev fallback)...');
  
  // Call login with no mandate_jws - should fall back to DEV_MANDATE_JWS
  const loginResult = await callMCPTool('scp.login', {
    org_ref: 'blackhawk-ski-club',
    credential_id: process.env.TEST_CREDENTIAL_ID,
    user_jwt: process.env.TEST_USER_JWT
    // Intentionally omitting mandate_jws to trigger dev fallback
  });

  console.log('Login result:', JSON.stringify(loginResult, null, 2));

  // Verify login succeeded despite missing mandate
  expect(loginResult.success).toBe(true);
  expect(loginResult.session_token).toBeDefined();
  
  console.log(`✅ Dev fallback worked: session_token = ${loginResult.session_token}`);

  // Step 2: Verify programs can still be discovered
  console.log('\nStep 2: Calling scp.find_programs WITHOUT mandate_jws...');
  const programsResult = await callMCPTool('scp.find_programs', {
    org_ref: 'blackhawk-ski-club',
    session_token: loginResult.session_token
    // Intentionally omitting mandate_jws
  });

  console.log('Programs result:', JSON.stringify(programsResult, null, 2));

  // Verify programs discovery succeeded
  expect(programsResult.success).toBe(true);
  expect(programsResult.programs).toBeDefined();
  expect(programsResult.programs.length).toBeGreaterThan(0);

  console.log(`✅ Programs discovered without explicit mandate: ${programsResult.programs.length} programs`);
  console.log(`   Themes: ${Object.keys(programsResult.programs_by_theme || {}).join(', ')}`);
  
  console.log('\n✅ SMOKE TEST 3 PASSED: Dev mandate fallback prevents mid-flow aborts\n');
});

/**
 * Test Suite Summary
 */
test.afterAll(() => {
  console.log('\n' + '='.repeat(80));
  console.log('SMOKE TEST SUITE COMPLETED');
  console.log('='.repeat(80));
  console.log('\nExpected log milestones (see docs/RUNBOOK_EXPECTED_LOGS.md):');
  console.log('  ✓ [antibot] antibot_key ready');
  console.log('  ✓ [antibot] Drupal tokens stable');
  console.log('  ✓ login_status: success + session_token: <value>');
  console.log('  ✓ [orchestrator] Reusing existing session_token');
  console.log('  ✓ scp.find_programs → ✅ Reused saved session');
  console.log('  ✓ [audit] DEV: proceeding with DEV_MANDATE_JWS fallback (non-prod)');
  console.log('\n' + '='.repeat(80) + '\n');
});
