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

async function startServer(opts: { telemetryEnabled: boolean; debugToken?: string }): Promise<{
  serverProcess: ChildProcess;
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const port = 21000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;

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

  const serverProcess = spawn('node', ['dist/mcp_server/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      RATE_LIMIT_ENABLED: 'false',
      EXPOSE_TELEMETRY_DEBUG: opts.telemetryEnabled ? 'true' : 'false',
      ...(opts.debugToken ? { EXPOSE_TELEMETRY_DEBUG_TOKEN: opts.debugToken } : {}),
      SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-openai-key',
      BOOKEO_API_KEY: process.env.BOOKEO_API_KEY || 'test-bookeo-key',
      BOOKEO_SECRET_KEY: process.env.BOOKEO_SECRET_KEY || 'test-bookeo-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStderr = '';
  serverProcess.stderr?.on('data', (chunk) => {
    serverStderr += String(chunk);
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    throw new Error(`Failed waiting for health: ${String(error)}\nServer stderr:\n${serverStderr}`);
  }

  const stop = async () => {
    if (serverProcess.exitCode == null) {
      serverProcess.kill('SIGTERM');
      await sleep(400);
    }
    if (serverProcess.exitCode == null) {
      serverProcess.kill('SIGKILL');
    }
  };

  return { serverProcess, baseUrl, stop };
}

describe('telemetry debug endpoint access controls', () => {
  let stopServer: (() => Promise<void>) | null = null;

  afterAll(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }
  });

  it('does not expose debug telemetry when EXPOSE_TELEMETRY_DEBUG is disabled', async () => {
    const started = await startServer({ telemetryEnabled: false });
    stopServer = started.stop;

    const res = await fetch(`${started.baseUrl}/debug/telemetry`, {
      headers: {
        'x-forwarded-for': '8.8.8.8',
      },
    });

    expect(res.status).not.toBe(200);

    await started.stop();
    stopServer = null;
  }, 60_000);

  it('returns 403 when debug telemetry is enabled but request is unauthorized', async () => {
    const started = await startServer({ telemetryEnabled: true, debugToken: 'secret-token' });
    stopServer = started.stop;

    const res = await fetch(`${started.baseUrl}/debug/telemetry`, {
      headers: {
        'x-forwarded-for': '8.8.8.8',
      },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data).toEqual(expect.objectContaining({ ok: false, error: 'forbidden' }));

    await started.stop();
    stopServer = null;
  }, 60_000);

  it('allows authorized debug telemetry access with a valid X-Debug-Token', async () => {
    const started = await startServer({ telemetryEnabled: true, debugToken: 'secret-token' });
    stopServer = started.stop;

    const res = await fetch(`${started.baseUrl}/debug/telemetry`, {
      headers: {
        'x-forwarded-for': '8.8.8.8',
        'x-debug-token': 'secret-token',
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(
      expect.objectContaining({
        ok: true,
        counters: expect.any(Object),
      }),
    );

    await started.stop();
    stopServer = null;
  }, 60_000);
});
