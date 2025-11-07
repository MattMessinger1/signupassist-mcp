/**
 * Regenerate Supabase TypeScript types from the database schema
 * 
 * This script fetches the latest schema from your Supabase project and generates
 * type definitions to ensure type safety across RPC calls and database queries.
 * 
 * Usage: npm run types:generate
 * 
 * Requirements:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env
 * - @supabase/supabase-js must be installed
 */

import "dotenv/config";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const SUPABASE_PROJECT_ID = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const OUTPUT_PATH = path.join(process.cwd(), "src/integrations/supabase/types.ts");

async function regenerateTypes() {
  console.log("🔄 Regenerating Supabase types...\n");

  if (!SUPABASE_PROJECT_ID) {
    console.error("❌ Error: Could not extract project ID from SUPABASE_URL");
    console.error("   Make sure SUPABASE_URL is set in .env");
    process.exit(1);
  }

  console.log(`📦 Project ID: ${SUPABASE_PROJECT_ID}`);
  console.log(`📁 Output: ${OUTPUT_PATH}\n`);

  try {
    // Generate types using Supabase CLI
    const { stdout, stderr } = await execAsync(
      `npx supabase gen types typescript --project-id ${SUPABASE_PROJECT_ID} --schema public`
    );

    if (stderr && !stderr.includes("Connecting")) {
      console.warn("⚠️  Warning:", stderr);
    }

    // Write types to file
    await writeFile(OUTPUT_PATH, stdout, "utf-8");

    console.log("✅ Successfully generated Supabase types!");
    console.log("\n📋 Next steps:");
    console.log("   1. Review the generated types in src/integrations/supabase/types.ts");
    console.log("   2. Verify RPC function signatures match your database functions");
    console.log("   3. Run 'npm run check:types' to validate type consistency");
    console.log("\n💡 Tip: Run this script after any database schema changes");

  } catch (error: any) {
    console.error("❌ Failed to generate types:", error.message);
    
    if (error.message.includes("supabase")) {
      console.error("\n💡 Make sure Supabase CLI is installed:");
      console.error("   npm install -g supabase");
    }
    
    if (error.message.includes("authentication") || error.message.includes("unauthorized")) {
      console.error("\n💡 Authentication failed. Verify your environment:");
      console.error("   - SUPABASE_URL is correct");
      console.error("   - SUPABASE_SERVICE_ROLE_KEY has proper permissions");
    }

    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  regenerateTypes();
}

export { regenerateTypes };
