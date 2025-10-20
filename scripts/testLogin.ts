import 'dotenv/config';
import { skiClubProTools } from '../mcp_server/providers/skiclubpro';

async function main() {
  console.log("🧠 Running live login smoke test...\n");
  console.log("Checking SkiClubPro credentials via Playwright...\n");
  console.log("⚙️ Launching browser, navigating to login page...\n");

  try {
    // Find the login tool
    const loginTool = skiClubProTools.find(tool => tool.name === 'scp.login');
    
    if (!loginTool) {
      throw new Error('Login tool not found in skiClubProTools');
    }

    // Call the login handler
    const result = await loginTool.handler({
      org_ref: process.env.TEST_ORG_REF || 'blackhawk-ski-club',
      email: process.env.TEST_USERNAME || process.env.TEST_EMAIL,
      password: process.env.TEST_PASSWORD,
      mandate_id: 'test-mandate-smoke',
      plan_execution_id: 'test-exec-smoke'
    });

    console.log("✅ Login successful — session established!\n");
    console.log("Result:\n");
    console.log(JSON.stringify(result, null, 2));
    console.log("\n🎉 Smoke test complete!");
    console.log("Next step: reconnect this login call to your orchestrator's run-plan so the AI flow can trigger it automatically.\n");
  } catch (error) {
    console.error("❌ Login failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
