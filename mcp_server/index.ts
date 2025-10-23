/**
 * SignupAssist MCP Server
 * Production-ready with OAuth manifest served at /mcp for ChatGPT discovery
 * Last deployment: 2025-10-20
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

// Register error handlers FIRST to catch any import failures
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

class SignupAssistMCPServer {
  private server: Server;
  private tools: Map<string, any> = new Map();
  private orchestrator: AIOrchestrator | null = null;

  constructor() {
    console.log('[STARTUP] SignupAssistMCPServer constructor called');
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
    console.log('[STARTUP] MCP Server instance created');
    
    this.setupRequestHandlers();
    this.registerTools();
  }

  async initializeOrchestrator() {
    try {
      console.log('[STARTUP] Dynamically importing AIOrchestrator...');
      const { default: AIOrchestrator } = await import('./ai/AIOrchestrator.js');
      console.log('[STARTUP] AIOrchestrator module loaded successfully');
      console.log('[STARTUP] AIOrchestrator type:', typeof AIOrchestrator);
      
      this.orchestrator = new AIOrchestrator();
      console.log('✅ AIOrchestrator initialized');
    } catch (error) {
      console.error('❌ WARNING: AIOrchestrator failed to load - server will start without it');
      console.error('Error:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('Tip: Set OPENAI_API_KEY environment variable if using OpenAI');
      this.orchestrator = null;
    }
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

  async startHTTP(): Promise<any> {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;

    const httpServer = createServer((req, res) => {
      // --- CORS setup
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-run-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);
      console.log(`[REQUEST] ${req.method} ${url.pathname}`);

      // --- Health check
      if (req.method === 'GET' && url.pathname === '/health') {
        console.log('[HEALTH] check received');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
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

      // --- Serve OpenAPI spec at /mcp/openapi.json
      if (req.method === 'GET' && url.pathname === '/mcp/openapi.json') {
        try {
          // Load openapi.json with fallback for Railway builds
          let openapiPath = path.resolve(process.cwd(), 'dist', 'mcp', 'openapi.json');
          if (!existsSync(openapiPath)) {
            // Fallback: use source copy
            openapiPath = path.resolve(process.cwd(), 'mcp', 'openapi.json');
          }
          console.log('[DEBUG] Using OpenAPI spec at:', openapiPath);
          const spec = readFileSync(openapiPath, 'utf8');
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(spec);
          console.log('[ROUTE] Served /mcp/openapi.json');
        } catch (error: any) {
          console.error('[OPENAPI ERROR]', error);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'OpenAPI spec not found. Run: npm run openapi:generate' 
          }));
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
        // Development mode bypass (non-production only)
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[AUTH] Dev mode: bypassing auth for /tools/call');
          // Continue to tool execution below
        } else {
          // Production auth validation
          const authHeader = req.headers['authorization'];
          const token = authHeader?.replace('Bearer ', '');
          const expectedToken = process.env.MCP_ACCESS_TOKEN;
          
          if (!token || token !== expectedToken) {
            res.writeHead(401, {
              "Content-Type": "application/json",
              "WWW-Authenticate": "Bearer realm=\"signupassist\", error=\"invalid_token\", error_description=\"Invalid or missing access token\""
            });
            res.end(JSON.stringify({ error: "Unauthorized - Invalid or missing token" }));
            console.log('[AUTH] Unauthorized access attempt to /tools/call');
            return;
          }
          
          console.log('[AUTH] Authorized request to /tools/call');
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

      // --- Orchestrator endpoint for Chat Test Harness
      if (url.pathname === '/orchestrator/chat') {
        console.log('[ROUTE] /orchestrator/chat hit');
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { message, sessionId, action, payload } = JSON.parse(body);
            
            // Check if orchestrator is available
            if (!this.orchestrator) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'AI Orchestrator unavailable', 
                details: 'Server started without AI capabilities. Check logs for initialization errors.' 
              }));
              return;
            }
            
            // Validate required fields
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId' }));
              return;
            }

            let result;
            
            // Route to appropriate orchestrator method
            if (action) {
              // Card action (button click)
              console.log(`[Orchestrator] handleAction: ${action}`);
              result = await this.orchestrator.handleAction(action, payload || {}, sessionId);
            } else if (message) {
              // Text message
              console.log(`[Orchestrator] generateResponse: ${message}`);
              result = await this.orchestrator.generateResponse(message, sessionId);
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing message or action' }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('[Orchestrator] Error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: err.message || 'Unknown error',
              message: "Something went wrong. Let's try that again.",
              cta: [{ label: "Retry", action: "retry_last", variant: "accent" }]
            }));
          }
        });
        return;
      }

      // --- Serve static frontend files (React SPA)
      if (req.method === 'GET') {
        const servePath = url.pathname === '/' ? '/index.html' : url.pathname;
        const filePath = path.resolve(process.cwd(), 'dist', 'client', `.${servePath}`);
        
        if (existsSync(filePath)) {
          // Determine content type by file extension
          const ext = path.extname(filePath);
          const contentTypeMap: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.json': 'application/json',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
          };
          const contentType = contentTypeMap[ext] || 'application/octet-stream';
          
          try {
            const content = readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
            console.log('[STATIC] Served:', servePath);
            return;
          } catch (err: any) {
            console.error('[STATIC ERROR]', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
            return;
          }
        }
        
        // For SPA routing: serve index.html for non-file paths
        if (!servePath.includes('.')) {
          try {
            const indexPath = path.resolve(process.cwd(), 'dist', 'client', 'index.html');
            const content = readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
            console.log('[SPA] Served index.html for:', url.pathname);
            return;
          } catch (err: any) {
            console.error('[SPA ERROR]', err);
            // Fall through to 404
          }
        }
      }

      // --- Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // Add error handler for the HTTP server
    httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[HTTP ERROR] Port ${port} is already in use`);
        process.exit(1);
      } else {
        console.error('[HTTP ERROR]', error);
        process.exit(1);
      }
    });

    // Log startup info before binding
    console.log(`[STARTUP] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[STARTUP] PORT: ${port}`);

    return new Promise((resolve, reject) => {
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`✅ MCP HTTP Server listening on port ${port}`);
        console.log(`   Health: http://localhost:${port}/health`);
        console.log(`   Manifest: http://localhost:${port}/mcp/manifest.json`);
        console.log(`   Root: http://localhost:${port}/mcp`);
        console.log(`   Well-known: http://localhost:${port}/.well-known/ai-plugin.json`);
        
        // CRITICAL: Give Railway's probe time to connect after bind
        setTimeout(() => {
          console.log('[STARTUP] Server ready for healthcheck');
          resolve(httpServer);
        }, 100);
      });

      httpServer.on('error', reject);
    });
  }
}

// --- Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, closing server gracefully...');
  process.exit(0);
});

// --- Startup sequence
console.log('[STARTUP] Registering prerequisite checkers...');
registerAllProviders();
console.log('[STARTUP] Prerequisite checkers registered');

console.log('[STARTUP] Creating SignupAssistMCPServer instance...');
const server = new SignupAssistMCPServer();

console.log('[STARTUP] Initializing AIOrchestrator asynchronously...');
await server.initializeOrchestrator();
console.log('[STARTUP] AIOrchestrator initialization complete');

console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);

// Enhanced logging for MCP_ACCESS_TOKEN
const token = process.env.MCP_ACCESS_TOKEN;
if (token) {
  console.log('[AUTH] Token configured:', token.slice(0, 4) + '****');
} else {
  console.warn('[AUTH] Warning: No MCP_ACCESS_TOKEN detected in environment');
}

if (process.env.NODE_ENV === 'production' || process.env.PORT) {
  console.log('[STARTUP] Starting HTTP server...');
  const startTime = Date.now();
  
  server.startHTTP()
    .then((httpServer) => {
      const bootTime = Date.now() - startTime;
      console.log('[STARTUP] ✅ HTTP server fully operational');
      console.log('[STARTUP] Boot time:', bootTime, 'ms');
      console.log('[STARTUP] Process uptime:', process.uptime().toFixed(2), 'seconds');
      console.log('[STARTUP] Memory usage:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');
      
      // Health monitoring heartbeat - logs every 30 seconds
      setInterval(() => {
        console.log('[HEARTBEAT] Server healthy | Uptime:', process.uptime().toFixed(0), 's | Memory:', 
          Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');
      }, 30000);
      
      // Keep reference to prevent garbage collection and ensure process stays alive
    })
    .catch((err) => {
      console.error('[STARTUP ERROR] Failed to start HTTP server:', err);
      console.error('[STARTUP ERROR] Stack:', err.stack);
      process.exit(1);
    });
} else {
  console.log('[STARTUP] Starting stdio server...');
  server.start().catch((err) => {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  });
}
