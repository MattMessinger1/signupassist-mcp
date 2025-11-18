import 'dotenv/config';
import { refreshBlackhawkPrograms } from '../mcp_server/providers/blackhawk.js';

(async () => {
  console.log('🧭 Initiating Blackhawk Ski Club program feed refresh (cron job)...');
  try {
    await refreshBlackhawkPrograms();
    console.log('✅ Blackhawk program feed refresh completed successfully.');
  } catch (e: any) {
    console.error('❌ Critical error in refreshProgramFeed:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
