import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

describe('orchestrator /orchestrator/chat out-of-scope boundary integration', () => {
  const port = 20000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProcess: ChildProcess | null = null;
  let serverStderr = '';

  beforeAll(async () => {
    if (!existsSync('dist/mcp_server/index.js')) {
      const build = spawnSync('npm', ['run', '-s', 'mcp:build'], {
        env: process.env,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (build.status !== 0) {
        throw new Error(`Failed to build MCP server for integration test:\n${build.stdout}\n${build.stderr}`);
      }
    }

    serverProcess = spawn('node', ['dist/mcp_server/index.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        RATE_LIMIT_ENABLED: 'false',
        EXPOSE_TELEMETRY_DEBUG: 'true',
        SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-openai-key',
        BOOKEO_API_KEY: process.env.BOOKEO_API_KEY || 'test-bookeo-key',
        BOOKEO_SECRET_KEY: process.env.BOOKEO_SECRET_KEY || 'test-bookeo-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stderr?.on('data', (chunk) => {
      serverStderr += String(chunk);
    });

    try {
      await waitForHealth(baseUrl);
    } catch (error) {
      throw new Error(`Failed waiting for health: ${String(error)}\nServer stderr:\n${serverStderr}`);
    }

    const clearRes = await fetch(`${baseUrl}/debug/telemetry/clear`, { method: 'POST' });
    expect(clearRes.ok).toBe(true);
  }, 60_000);

  afterAll(async () => {
    if (!serverProcess) return;
    if (serverProcess.exitCode == null) {
      serverProcess.kill('SIGTERM');
      await sleep(400);
    }
    if (serverProcess.exitCode == null) {
      serverProcess.kill('SIGKILL');
    }
  }, 15_000);

  it('returns outOfScope object shape and increments blocked counters for adult signup requests', async () => {
    const response = await fetch(`${baseUrl}/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'integration-test-session',
        message: 'Please register me for adult swimming lessons this weekend.',
      }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual(
      expect.objectContaining({
        message: expect.any(String),
        metadata: expect.objectContaining({
          outOfScope: true,
          suppressWizardHeader: true,
          reason: 'adult_signup_request',
        }),
        context: expect.objectContaining({
          step: 'BROWSE',
        }),
      }),
    );

    const telemetryRes = await fetch(`${baseUrl}/debug/telemetry`);
    expect(telemetryRes.status).toBe(200);
    const telemetryData = await telemetryRes.json();

    expect(telemetryData.counters['guardrail.child_scope.blocked_total']).toBe(1);
    expect(telemetryData.counters['guardrail.child_scope.blocked_adult_signup_total']).toBe(1);
    expect(telemetryData.events.blockedRequests).toBe(1);
  });
});
