/**
 * SignupAssist MCP Server
 * Production-ready with OAuth manifest served at /mcp for ChatGPT discovery
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { URL, fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import path, { dirname } from 'path';
import crypto from 'crypto';

// ✅ Fix for ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import tool providers
import { skiClubProTools } from './providers/skiclubpro.js';
// import { daysmartTools } from '../providers/daysmart/index';
// import { campminderTools } from '../providers/campminder/index';

// Import prereqs registry
import { registerAllProviders } from './prereqs/providers.js';

class SignupAssistMCPServer {
  private server: Server;
  private tools: Map<string, any> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'signupassist-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupRequestHandlers();
    this.registerTools();
  }

  private setupRequestHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: Array.from(this.tools.values()) };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!this.tools.has(name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
      }
      const tool = this.tools.get(name);
      return await tool.handler(args);
    });
  }

  private registerTools() {
    // Register SkiClubPro tools
    Object.entries(skiClubProTools).forEach(([name, handler]) => {
      this.tools.set(name, {
        name,
        description: `SkiClubPro provider tool: ${name}`,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
        handler,
      });
    });

    const arrayTools: any[] = [];
    arrayTools.forEach((tool) => this.tools.set(tool.name, tool));
  }

  getToolsList() {
    return Array.from(this.tools.keys());
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('SignupAssist MCP Server started (stdio mode)');
  }

  async startHTTP() {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;

    const httpServer = createServer((req, res) => {
      // --- CORS setup
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // --- Health check
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tools: this.getToolsList() }));
        return;
      }

      // --- Serve manifest.json at /mcp/manifest.json
      if (req.method === 'GET' && url.pathname === '/mcp/manifest.json') {
        try {
          // Load manifest.json with fallback for Railway builds
          let manifestPath = path.resolve(process.cwd(), 'dist', 'mcp', 'manifest.json');
          if (!existsSync(manifestPath)) {
            // Fallback: use source copy
            manifestPath = path.resolve(process.cwd(), 'mcp', 'manifest.json');
          }
          console.log('[DEBUG] Using manifest at:', manifestPath);
          const manifest = readFileSync(manifestPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(manifest);
          console.log('[ROUTE] Served /mcp/manifest.json');
        } catch (error: any) {
          console.error('[MANIFEST ERROR]', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load manifest', details: error.message }));
        }
        return;
      }

      // --- Serve manifest JSON directly at /mcp (ChatGPT OAuth discovery)
      if (req.method === 'GET' && (url.pathname === '/mcp' || url.pathname === '/mcp/')) {
        try {
          // Load manifest.json with fallback for Railway builds
          let manifestPath = path.resolve(process.cwd(), 'dist', 'mcp', 'manifest.json');
          if (!existsSync(manifestPath)) {
            // Fallback: use source copy
            manifestPath = path.resolve(process.cwd(), 'mcp', 'manifest.json');
          }
          console.log('[DEBUG] Using manifest at:', manifestPath);
          const manifest = readFileSync(manifestPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(manifest);
        } catch (error: any) {
          console.error('[MCP ROOT ERROR]', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load manifest', details: error.message }));
        }
        return;
      }

      // --- Serve manifest at .well-known path (legacy plugin compatibility)
      if (req.method === 'GET' && url.pathname === '/.well-known/ai-plugin.json') {
        try {
          // Load manifest.json with fallback for Railway builds
          let manifestPath = path.resolve(process.cwd(), 'dist', 'mcp', 'manifest.json');
          if (!existsSync(manifestPath)) {
            // Fallback: use source copy
            manifestPath = path.resolve(process.cwd(), 'mcp', 'manifest.json');
          }
          console.log('[DEBUG] Using manifest at:', manifestPath);
          const manifest = readFileSync(manifestPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(manifest);
          console.log('[ROUTE] Served /.well-known/ai-plugin.json');
        } catch (error: any) {
          console.error('[WELL-KNOWN ERROR]', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load manifest', details: error.message }));
        }
        return;
      }

      // --- Tool invocation endpoint
      if (url.pathname === '/tools/call') {
        // Check for Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.writeHead(401, {
            "Content-Type": "application/json",
            "WWW-Authenticate": "Bearer realm=\"signupassist\", error=\"invalid_token\", error_description=\"Access token is missing\""
          });
          res.end(JSON.stringify({ error: "Unauthorized - Access token is missing" }));
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported. Use POST with { tool, args }.' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            const { tool, args } = parsed;
            if (!tool) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing required field: tool' }));
              return;
            }

            if (!this.tools.has(tool)) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: `Tool '${tool}' not found. Available: ${Array.from(this.tools.keys()).join(', ')}`,
                })
              );
              return;
            }

            const runId = req.headers['x-run-id'] || crypto.randomUUID();
            const stage = args?.stage || 'program';
            const prefix = stage === 'prereq' ? '[Prereq]' : '[Program]';
            console.log(`${prefix} run=${runId} start tool=${tool}`);

            const toolInstance = this.tools.get(tool);
            const enrichedArgs = { ...args, _stage: stage, _run_id: runId };
            const result = await toolInstance.handler(enrichedArgs);

            console.log(`${prefix} run=${runId} done success=${!!result?.success}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('[TOOLS/CALL ERROR]', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
          }
        });
        return;
      }

      // --- List tools
      if (req.method === 'GET' && url.pathname === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            tools: Array.from(this.tools.values()).map((t) => ({
              name: t.name,
              description: t.description,
            })),
          })
        );
        return;
      }

      // --- Serve ai-plugin.json from both /.well-known and /mcp/.well-known
      if (
        req.method === "GET" &&
        (url.pathname === "/.well-known/ai-plugin.json" ||
         url.pathname === "/mcp/.well-known/ai-plugin.json")
      ) {
        try {
          // use your existing manifest file
          const manifestPath = path.resolve(process.cwd(), "mcp", "manifest.json");
          const manifest = readFileSync(manifestPath, "utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(manifest);
          console.log("[ROUTE] Served ai-plugin.json for", url.pathname);
        } catch (error: any) {
          console.error("[AI-PLUGIN SERVE ERROR]", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to load ai-plugin.json", details: error.message }));
        }
        return;
      }

      // --- Serve /.well-known/openai-connector.json (ChatGPT connector discovery)
      if (
        req.method === "GET" &&
        (url.pathname === "/.well-known/openai-connector.json" ||
         url.pathname === "/mcp/.well-known/openai-connector.json")
      ) {
        try {
          const manifestPath = path.resolve(process.cwd(), "mcp", "manifest.json");
          const manifest = readFileSync(manifestPath, "utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(manifest);
          console.log("[ROUTE] Served openai-connector.json for", url.pathname);
        } catch (error: any) {
          console.error("[CONNECTOR JSON ERROR]", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to load openai-connector.json", details: error.message }));
        }
        return;
      }

      // --- Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`✅ SignupAssist MCP HTTP Server listening on port ${port}`);
      console.log(`   Health: http://localhost:${port}/health`);
      console.log(`   Manifest: http://localhost:${port}/mcp/manifest.json`);
      console.log(`   Root: http://localhost:${port}/mcp`);
      console.log(`   Well-known: http://localhost:${port}/.well-known/ai-plugin.json`);
    });
  }
}

// --- Startup sequence
console.log('[STARTUP] Registering prerequisite checkers...');
registerAllProviders();
console.log('[STARTUP] Prerequisite checkers registered');

console.log('[STARTUP] Creating SignupAssistMCPServer instance...');
const server = new SignupAssistMCPServer();

console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);

if (process.env.NODE_ENV === 'production' || process.env.PORT) {
  console.log('[STARTUP] Starting HTTP server...');
  server.startHTTP().catch((err) => {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  });
} else {
  console.log('[STARTUP] Starting stdio server...');
  server.start().catch((err) => {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  });
}
