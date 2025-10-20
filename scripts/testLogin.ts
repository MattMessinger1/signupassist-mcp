import 'dotenv/config';
import { skiClubProTools } from '../mcp_server/providers/skiclubpro';

// Simple wrapper to match expected interface
const scp = {
  login: async (args: { org_ref: string; username: string; password: string }) => {
    // Note: The actual scp.login requires credential_id and user_jwt
    // For smoke testing, we're calling it with minimal args
    // In production, these would come from your mandate/auth system
    return await skiClubProTools['scp.login']({
      credential_id: 'test-cred-id',
      user_jwt: 'test-jwt-token',
      org_ref: args.org_ref,
      mandate_id: 'test-mandate-smoke',
      plan_execution_id: 'test-exec-smoke'
    });
  }
};

async function main() {
  console.log("🧠 Running live login smoke test...");

  const result = await scp.login({
    org_ref: "blackhawk-ski-club",
    username: process.env.TEST_USERNAME!,
    password: process.env.TEST_PASSWORD!,
  });

  console.log("Result:", result);
}

main();
