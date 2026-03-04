import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
  return await import('../mcp_server/providers/registrations.js');
}

test('registration throttle allows under threshold', async () => {
  process.env.REGISTRATION_THROTTLE_USER_MAX_PER_DAY = '2';
  process.env.REGISTRATION_THROTTLE_CHILD_MAX_PER_DAY = '2';
  process.env.REGISTRATION_THROTTLE_WINDOW_MS = '60000';
  const mod = await loadModule();
  mod.__resetRegistrationThrottleForTests();

  const result = mod.__shouldThrottleRegistrationCreate({
    user_id: 'user-1',
    participant_names: ['Child A'],
  });

  assert.equal(result.limited, false);
});

test('registration throttle blocks after exceeding per-user limit', async () => {
  process.env.REGISTRATION_THROTTLE_USER_MAX_PER_DAY = '1';
  process.env.REGISTRATION_THROTTLE_CHILD_MAX_PER_DAY = '5';
  process.env.REGISTRATION_THROTTLE_WINDOW_MS = '60000';
  const mod = await loadModule();
  mod.__resetRegistrationThrottleForTests();

  mod.__shouldThrottleRegistrationCreate({ user_id: 'user-1', participant_names: ['Child A'] });
  const blocked = mod.__shouldThrottleRegistrationCreate({ user_id: 'user-1', participant_names: ['Child B'] });

  assert.equal(blocked.limited, true);
  assert.equal(blocked.dimension, 'user');
});

test('registration throttle keeps separate user counters independent', async () => {
  process.env.REGISTRATION_THROTTLE_USER_MAX_PER_DAY = '1';
  process.env.REGISTRATION_THROTTLE_CHILD_MAX_PER_DAY = '5';
  process.env.REGISTRATION_THROTTLE_WINDOW_MS = '60000';
  const mod = await loadModule();
  mod.__resetRegistrationThrottleForTests();

  mod.__shouldThrottleRegistrationCreate({ user_id: 'user-1', participant_names: ['Child A'] });
  const user1Blocked = mod.__shouldThrottleRegistrationCreate({ user_id: 'user-1', participant_names: ['Child A'] });
  const user2Allowed = mod.__shouldThrottleRegistrationCreate({ user_id: 'user-2', participant_names: ['Child A'] });

  assert.equal(user1Blocked.limited, true);
  assert.equal(user2Allowed.limited, false);
});
