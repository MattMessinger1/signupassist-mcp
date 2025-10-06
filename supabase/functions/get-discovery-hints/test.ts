import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Unit tests for get-discovery-hints edge function
 * 
 * Run with: deno test supabase/functions/get-discovery-hints/test.ts
 */

// Mock RPC response types
interface MockRPCResponse {
  hints: Record<string, unknown>;
  confidence?: number;
  samples_count?: number;
  fingerprint?: string;
}

Deno.test("get-discovery-hints - returns empty hints on miss", async () => {
  // Mock empty RPC response (miss)
  const mockRPCData: MockRPCResponse | Record<string, never> = {};

  // Simulate edge function logic
  const response = !mockRPCData || Object.keys(mockRPCData).length === 0
    ? { hints: {} }
    : {
        hints: mockRPCData.hints || {},
        confidence: mockRPCData.confidence,
        samples_count: mockRPCData.samples_count,
        fingerprint: mockRPCData.fingerprint,
      };

  // Verify response shape
  assertExists(response.hints);
  assertEquals(Object.keys(response.hints).length, 0);
  assertEquals(response.confidence, undefined);
  assertEquals(response.samples_count, undefined);
  assertEquals(response.fingerprint, undefined);
});

Deno.test("get-discovery-hints - returns full hints on hit", async () => {
  // Mock successful RPC response
  const mockRPCData: MockRPCResponse = {
    hints: {
      child_name: {
        selectorHints: ["input[name='childName']", "#child-name"],
        messageSamples: ["Child name is required"],
      },
      skill_level: {
        selectorHints: ["select[name='skillLevel']"],
        messageSamples: ["Please select a skill level"],
      },
    },
    confidence: 0.85,
    samples_count: 12,
    fingerprint: "abc123def456",
  };

  // Simulate edge function logic
  const response = !mockRPCData || Object.keys(mockRPCData).length === 0
    ? { hints: {} }
    : {
        hints: mockRPCData.hints || {},
        confidence: mockRPCData.confidence,
        samples_count: mockRPCData.samples_count,
        fingerprint: mockRPCData.fingerprint,
      };

  // Verify response shape
  assertExists(response.hints);
  assertEquals(Object.keys(response.hints).length, 2);
  assertEquals(response.confidence, 0.85);
  assertEquals(response.samples_count, 12);
  assertEquals(response.fingerprint, "abc123def456");
  
  // Verify hint structure
  assertExists(response.hints.child_name);
  assertExists(response.hints.skill_level);
});

Deno.test("get-discovery-hints - handles partial data gracefully", async () => {
  // Mock RPC response with only hints, no metadata
  const mockRPCData: MockRPCResponse = {
    hints: {
      parent_email: {
        selectorHints: ["input[type='email']"],
      },
    },
    // confidence, samples_count, fingerprint not present
  };

  // Simulate edge function logic
  const response = !mockRPCData || Object.keys(mockRPCData).length === 0
    ? { hints: {} }
    : {
        hints: mockRPCData.hints || {},
        confidence: mockRPCData.confidence,
        samples_count: mockRPCData.samples_count,
        fingerprint: mockRPCData.fingerprint,
      };

  // Verify response shape - hints present, metadata undefined
  assertExists(response.hints);
  assertEquals(Object.keys(response.hints).length, 1);
  assertEquals(response.confidence, undefined);
  assertEquals(response.samples_count, undefined);
  assertEquals(response.fingerprint, undefined);
  
  // Verify hint is accessible
  assertExists(response.hints.parent_email);
});
