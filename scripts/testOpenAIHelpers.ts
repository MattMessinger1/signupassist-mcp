/**
 * Run OpenAI helper unit tests
 * Usage: npx vitest run mcp_server/lib/openaiHelpers.test.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runTests() {
  console.log('🧪 Running OpenAI helper unit tests...\n');
  
  try {
    const { stdout, stderr } = await execAsync(
      'npx vitest run mcp_server/lib/openaiHelpers.test.ts',
      { cwd: process.cwd() }
    );
    
    console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log('\n✅ Tests completed successfully');
  } catch (error: any) {
    console.error('❌ Tests failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}
