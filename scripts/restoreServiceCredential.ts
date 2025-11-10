/**
 * Re-store SkiClubPro Service Credential
 * This script calls the MCP server's /tools/cred-store endpoint
 * to encrypt and store credentials using the current CRED_SEAL_KEY
 * 
 * Usage: npx tsx scripts/restoreServiceCredential.ts
 */

import 'dotenv/config';
import readline from 'readline';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || process.env.VITE_MCP_BASE_URL;
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;

if (!MCP_SERVER_URL) {
  console.error('❌ Error: MCP_SERVER_URL not set');
  console.error('Example: export MCP_SERVER_URL=https://signupassist-mcp-production.up.railway.app');
  process.exit(1);
}

if (!MCP_ACCESS_TOKEN) {
  console.error('❌ Error: MCP_ACCESS_TOKEN not set');
  console.error('This is required for authentication');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('🔐 Re-storing SkiClubPro Service Credential');
  console.log('----------------------------------------');

  const provider = (await question('Provider (default: skiclubpro): ')) || 'skiclubpro';
  const alias = (await question('Alias (default: Blackhawk Service Credential): ')) || 'Blackhawk Service Credential';
  const email = await question('Email: ');
  
  if (!email) {
    console.error('❌ Email is required');
    rl.close();
    process.exit(1);
  }

  const password = await question('Password: ');
  
  if (!password) {
    console.error('❌ Password is required');
    rl.close();
    process.exit(1);
  }

  rl.close();

  console.log('\n📤 Storing credential...');

  try {
    const response = await fetch(`${MCP_SERVER_URL}/tools/cred-store`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MCP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        alias,
        email,
        password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Failed to store credential (HTTP ${response.status})`);
      console.error(data);
      process.exit(1);
    }

    console.log('✅ Credential stored successfully!');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n📋 Credential ID:', data.id);
    console.log('\n💡 Update your SCP_SERVICE_CRED_ID secret with this ID:');
    console.log(`   SCP_SERVICE_CRED_ID=${data.id}`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
