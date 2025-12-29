#!/usr/bin/env tsx
/**
 * Run Smoke Tests
 * 
 * Quick runner script for smoke tests that can be executed from npm scripts
 * or directly from the command line.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m'
};

console.log(`${colors.bright}${colors.cyan}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log('  SMOKE TESTS - API-Only Program Discovery Flow (No SCP/Browserbase)');
console.log('═══════════════════════════════════════════════════════════════');
console.log(colors.reset);

// Check for required environment variables
const requiredEnvVars = [
  'MCP_SERVER_URL',
  'MCP_ACCESS_TOKEN'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.log(`${colors.red}✗ Missing required environment variables:${colors.reset}`);
  missingVars.forEach(varName => {
    console.log(`  - ${varName}`);
  });
  console.log(`\n${colors.yellow}Please set these variables in your .env file or environment.${colors.reset}\n`);
  console.log('See mcp_server/tests/README.smoke.md for details.\n');
  process.exit(1);
}

console.log(`${colors.green}✓ Environment variables configured${colors.reset}\n`);

// Display test configuration
console.log(`${colors.bright}Configuration:${colors.reset}`);
console.log(`  MCP Server: ${process.env.MCP_SERVER_URL}`);
console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`  Auth: ${process.env.MCP_ACCESS_TOKEN ? 'MCP_ACCESS_TOKEN configured' : 'No token (dev only)'}`);
console.log();

console.log(`${colors.bright}Running tests...${colors.reset}\n`);

// Run API-only smoke test script using local tsx (avoids npx/global npm issues)
const tsxBin = path.resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

const runner = spawn(tsxBin, ['scripts/smokeApiOnly.ts'], {
  stdio: 'inherit',
  shell: true
});

runner.on('close', (code) => {
  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (code === 0) {
    console.log(`${colors.green}${colors.bright}✓ ALL SMOKE TESTS PASSED${colors.reset}`);
    console.log();
    console.log('Milestones verified:');
    console.log('  ✓ bookeo.find_programs returns programs for aim-design');
    console.log('  ✓ bookeo.discover_required_fields returns required fields');
    console.log('  ✓ signupassist.chat returns Step headers');
    console.log('  ✓ scp.* tools are not registered');
  } else {
    console.log(`${colors.red}${colors.bright}✗ SMOKE TESTS FAILED${colors.reset}`);
    console.log();
    console.log('Troubleshooting:');
    console.log('  1. Check docs/RUNBOOK_EXPECTED_LOGS.md for expected milestones');
    console.log('  2. Review mcp_server/tests/README.smoke.md for common issues');
    console.log('  3. Verify all environment variables are set correctly');
    console.log('  4. Check MCP server logs for detailed error messages');
  }
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  
  process.exit(code || 0);
});

runner.on('error', (error) => {
  console.error(`${colors.red}Failed to run smoke tests:${colors.reset}`, error);
  process.exit(1);
});
