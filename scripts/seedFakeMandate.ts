import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function main() {
  console.log("🧠 Seeding fake mandate for smoke test...\n");

  const fakePlanId = "00000000-0000-0000-0000-000000000001";
  const fakeExecId = "00000000-0000-0000-0000-000000000002";
  let fakeUserId: string;

  // First, create or get a test user
  console.log("👤 Creating test user...");
  const testEmail = "smoke-test@signupassist.test";
  const testPassword = "test-password-123!";

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });

  if (authError) {
    if (authError.message.includes("already registered")) {
      console.log("ℹ️ Test user already exists, fetching...");
      const { data: users } = await supabase.auth.admin.listUsers();
      const existingUser = users?.users.find(u => u.email === testEmail);
      if (existingUser) {
        fakeUserId = existingUser.id;
        console.log(`✅ Using existing user: ${fakeUserId}`);
      } else {
        console.error("❌ Could not find or create test user");
        process.exit(1);
      }
    } else {
      console.error("❌ User creation failed:", authError.message);
      process.exit(1);
    }
  } else {
    fakeUserId = authData.user.id;
    console.log(`✅ Test user created: ${fakeUserId}`);
  }

  // Create a fake plan
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

  // Create the plan execution
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
