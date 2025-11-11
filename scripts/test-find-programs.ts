/**
 * Manual test script for scp.find_programs tool
 * Usage: npx tsx scripts/test-find-programs.ts [org_ref] [category]
 * Example: npx tsx scripts/test-find-programs.ts blackhawk-ski-club all
 */

import { config } from 'dotenv';
config();

// Dynamic import of MCP client
async function runTest() {
  const org_ref = process.argv[2] || 'blackhawk-ski-club';
  const category = process.argv[3] || 'all';
  
  const mandate = process.env.SYSTEM_MANDATE_JWS;
  const credential = process.env.SCP_SERVICE_CRED_ID;
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  const mcpAccessToken = process.env.MCP_ACCESS_TOKEN;

  if (!mandate) {
    console.error('❌ SYSTEM_MANDATE_JWS not set in environment');
    process.exit(1);
  }
  
  if (!credential) {
    console.error('❌ SCP_SERVICE_CRED_ID not set in environment');
    process.exit(1);
  }

  if (!mcpServerUrl) {
    console.error('❌ MCP_SERVER_URL not set in environment');
    process.exit(1);
  }

  console.log(`\n[TEST] 🚀 Testing scp.find_programs`);
  console.log(`[TEST] 📍 Organization: ${org_ref}`);
  console.log(`[TEST] 🏷️  Category: ${category}`);
  console.log(`[TEST] 🔗 MCP Server: ${mcpServerUrl}`);
  console.log(`[TEST] 🎫 Credential: ${credential}`);
  console.log(`[TEST] ✅ Mandate: ${mandate.substring(0, 50)}...`);
  
  try {
    const response = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mcpAccessToken}`
      },
      body: JSON.stringify({
        tool: 'scp.find_programs',
        args: {
          credential_id: credential,
          org_ref,
          category,
          mandate_jws: mandate,
          user_jwt: mandate,
          skipCache: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n[TEST] ❌ HTTP ${response.status}:`, errorText);
      process.exit(1);
    }

    const result = await response.json();
    
    console.log(`\n[TEST] ✅ Success: ${result.success}`);
    console.log(`[TEST] 📊 Programs found: ${result.programs?.length || 0}`);
    
    if (result.error) {
      console.log(`[TEST] ⚠️  Error: ${result.error}`);
    }
    
    console.log(`\n[TEST] 📄 Full Response:`);
    console.log(JSON.stringify(result, null, 2));
    
    if (result.programs && result.programs.length > 0) {
      console.log(`\n[TEST] 🎯 First Program Sample:`);
      console.log(JSON.stringify(result.programs[0], null, 2));
    }
    
  } catch (error: any) {
    console.error(`\n[TEST] ❌ Exception:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
