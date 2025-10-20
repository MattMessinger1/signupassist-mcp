import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("🧠 Seeding fake mandate for smoke test...\n");

  const fakeUserId = "00000000-0000-0000-0000-000000000000";
  const fakePlanId = "test-plan-smoke";
  const fakeExecId = "test-exec-smoke";

  // First, create a fake plan
  console.log("📝 Creating fake plan...");
  const { error: planError } = await supabase
    .from("plans")
    .upsert({
      id: fakePlanId,
      user_id: fakeUserId,
      provider: "skiclubpro",
      program_ref: "blackhawk-ski-club",
      opens_at: new Date().toISOString(),
      status: "scheduled"
    }, {
      onConflict: "id"
    });

  if (planError && !planError.message.includes("duplicate")) {
    console.error("❌ Plan insert failed:", planError.message);
    process.exit(1);
  }

  // Then create the plan execution
  console.log("⚡ Creating fake plan execution...");
  const { error: execError } = await supabase
    .from("plan_executions")
    .upsert({
      id: fakeExecId,
      plan_id: fakePlanId,
      started_at: new Date().toISOString()
    }, {
      onConflict: "id"
    });

  if (execError) {
    console.error("❌ Execution insert failed:", execError.message);
    process.exit(1);
  }

  console.log("✅ Fake mandate created successfully!\n");
  console.log("🎉 Perfect! The audit middleware will now see an active plan execution.\n");
  console.log("Now run your smoke test:");
  console.log("  npx tsx --env-file=.env scripts/testLogin.ts\n");
}

main();
