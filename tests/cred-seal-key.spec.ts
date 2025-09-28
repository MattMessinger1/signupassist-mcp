import { test, expect } from '@playwright/test';

/**
 * End-to-end tests for CRED_SEAL_KEY functionality
 * Tests credential storage, encryption, and retrieval
 */

const SUPABASE_URL = 'https://jpcrphdevmvzcfgokgym.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik';

// Test credentials
const testCredentials = {
  alias: 'Test Ski Club Pro',
  provider_slug: 'skiclubpro',
  email: 'test@example.com',
  password: 'test-password-123'
};

test.describe('CRED_SEAL_KEY Tests', () => {
  let authToken: string;
  let credentialId: string;

  test.beforeAll(async ({ request }) => {
    // Create test user and get auth token
    const signUpResponse = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      data: {
        email: `test-${Date.now()}@example.com`,
        password: 'test-password-123'
      }
    });

    if (signUpResponse.ok()) {
      const signUpData = await signUpResponse.json();
      authToken = signUpData.access_token;
    } else {
      throw new Error('Failed to create test user');
    }
  });

  test('should verify CRED_SEAL_KEY is present in debug-env', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/functions/v1/debug-env`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.envVars.CRED_SEAL_KEY).toBe('SET');
    expect(data.keyPreviews.CRED_SEAL_KEY).toMatch(/^.{5}\.\.\.$/);
  });

  test('should verify CRED_SEAL_KEY in cred-debug', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/functions/v1/cred-debug`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.CRED_SEAL_KEY_present).toBe(true);
  });

  test('should store credentials with encryption', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/functions/v1/store-credentials`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: testCredentials
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.id).toBeDefined();
    expect(data.alias).toBe(testCredentials.alias);
    expect(data.provider).toBe(testCredentials.provider_slug);
    expect(data.created_at).toBeDefined();
    
    credentialId = data.id;
  });

  test('should verify credentials are encrypted in database', async ({ request }) => {
    // Query the stored_credentials table directly to verify encryption
    const response = await request.get(`${SUPABASE_URL}/rest/v1/stored_credentials`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        'id': `eq.${credentialId}`,
        'select': 'encrypted_data'
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveLength(1);
    const encryptedData = data[0].encrypted_data;
    
    // Verify that the data is encrypted (contains base64 and IV separator)
    expect(encryptedData).toMatch(/^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    
    // Verify it doesn't contain plain text credentials
    expect(encryptedData).not.toContain(testCredentials.email);
    expect(encryptedData).not.toContain(testCredentials.password);
  });

  test('should decrypt credentials correctly', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/functions/v1/cred-get`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        id: credentialId
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.id).toBe(credentialId);
    expect(data.alias).toBe(testCredentials.alias);
    expect(data.provider).toBe(testCredentials.provider_slug);
    expect(data.email).toBe(testCredentials.email);
    expect(data.password).toBe(testCredentials.password);
  });

  test('should fail gracefully with missing CRED_SEAL_KEY', async ({ request }) => {
    // This test simulates what would happen if CRED_SEAL_KEY was missing
    // We can't actually remove the key, but we can verify error handling
    
    const response = await request.post(`${SUPABASE_URL}/functions/v1/cred-get`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        id: 'non-existent-id'
      }
    });

    // Should return proper error, not crash
    expect([404, 500]).toContain(response.status());
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('should handle corrupted encrypted data', async ({ request }) => {
    // Store credentials first
    const storeResponse = await request.post(`${SUPABASE_URL}/functions/v1/store-credentials`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        ...testCredentials,
        alias: 'Corrupted Test'
      }
    });

    expect(storeResponse.ok()).toBeTruthy();
    const storeData = await storeResponse.json();
    const corruptedCredId = storeData.id;

    // Manually corrupt the data in the database
    const updateResponse = await request.patch(`${SUPABASE_URL}/rest/v1/stored_credentials`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        'id': `eq.${corruptedCredId}`
      },
      data: {
        encrypted_data: 'corrupted:data'
      }
    });

    expect(updateResponse.ok()).toBeTruthy();

    // Try to decrypt corrupted data
    const decryptResponse = await request.post(`${SUPABASE_URL}/functions/v1/cred-get`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        id: corruptedCredId
      }
    });

    expect(decryptResponse.status()).toBe(500);
    const errorData = await decryptResponse.json();
    expect(errorData.error).toContain('Failed to decrypt');
  });

  test('should validate start-signup-job has CRED_SEAL_KEY', async ({ request }) => {
    // This test verifies that start-signup-job function has access to CRED_SEAL_KEY
    // We'll try to call it without proper setup to see if it fails appropriately
    
    const response = await request.post(`${SUPABASE_URL}/functions/v1/start-signup-job`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        plan_id: 'test-plan-id'
      }
    });

    // Should fail due to missing plan, but not due to missing CRED_SEAL_KEY
    expect([400, 404]).toContain(response.status());
    const data = await response.json();
    expect(data.error).not.toContain('CRED_SEAL_KEY');
  });

  test.afterAll(async ({ request }) => {
    // Clean up: delete test credentials
    if (credentialId) {
      await request.delete(`${SUPABASE_URL}/rest/v1/stored_credentials`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          'id': `eq.${credentialId}`
        }
      });
    }
  });
});

test.describe('CRED_SEAL_KEY Environment Validation', () => {
  test('should fail if CRED_SEAL_KEY is missing from any function', async ({ request }) => {
    const functions = ['store-credentials', 'cred-get', 'cred-debug'];
    
    for (const functionName of functions) {
      const response = await request.post(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        data: {}
      });

      // All functions should handle missing auth gracefully, not crash due to missing CRED_SEAL_KEY
      expect(response.status()).not.toBe(502); // Bad Gateway would indicate server crash
      
      if (!response.ok()) {
        const data = await response.json();
        // If there's an error, it should be about missing auth/params, not missing CRED_SEAL_KEY
        if (data.error && data.error.includes('CRED_SEAL_KEY')) {
          throw new Error(`Function ${functionName} is missing CRED_SEAL_KEY: ${data.error}`);
        }
      }
    }
  });
});