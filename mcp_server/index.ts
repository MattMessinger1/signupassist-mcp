/**
 * SignupAssist MCP Server
 * Production-ready with OAuth manifest served at /mcp for ChatGPT discovery
 * Last deployment: 2025-10-20
 * Railway rebuild trigger: 2025-10-28 - Added scp.create_mandate tool
 */

// Version info for runtime debugging
const VERSION_INFO = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'dev',
  builtAt: new Date().toISOString(),
  nodeVersion: process.version,
  useNewAAP: process.env.USE_NEW_AAP === 'true'
};

// Import Auth0 middleware and protected actions config
import { verifyAuth0Token, extractBearerToken, getAuth0Config } from './middleware/auth0.js';
import { isProtectedAction, PROTECTED_ACTIONS } from './config/protectedActions.js';

// Print build info banner on startup
console.info(
  `[BUILD] Version: ${VERSION_INFO.commit} | Built: ${VERSION_INFO.builtAt} | USE_NEW_AAP: ${VERSION_INFO.useNewAAP}`
);

// ============================================================================
// Type Exports - Single Source of Truth
// ============================================================================
// All types are centrally defined in ./types.ts and re-exported here
// Import types from mcp_server/types throughout the codebase
export * from './types.js';

// ============================================================================
// Core Imports
// ============================================================================

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
import { bookeoTools } from './providers/bookeo.js';
import { stripeTools } from './providers/stripe.js';
import { programFeedTools } from './providers/programFeed.js';
import { mandateTools } from './providers/mandates.js';
import { schedulerTools } from './providers/scheduler.js';
import { registrationTools } from './providers/registrations.js';
import { userTools } from './providers/user.js';
// import { daysmartTools } from '../providers/daysmart/index';
// import { campminderTools } from '../providers/campminder/index';
import { refreshBlackhawkPrograms, refreshBlackhawkProgramDetail } from './providers/blackhawk.js'; // Import Blackhawk refresh functions
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for database operations (service role)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Import page readiness registry and helpers
import { registerReadiness } from './providers/utils/pageReadinessRegistry.js';
import { waitForSkiClubProReady } from './providers/utils/skiclubproReadiness.js';

// Import prereqs registry
import { registerAllProviders } from './prereqs/providers.js';

// Import provider and organization registries
import './providers/skiclubpro/config.js'; // Auto-registers SkiClubPro
import './providers/bookeo/config.js'; // Auto-registers Bookeo
import './config/organizations.js'; // Auto-registers organizations
// import './providers/campminder/config.js'; // Uncomment when ready

// Import OpenAI smoke test
import { runOpenAISmokeTests } from './startup/openaiSmokeTest.js';

// Import provider cache preloader
import { preloadProviderCache } from './startup/preloadProviders.js';

// Type-only imports for orchestrators (safe - doesn't execute module code)
import type { IOrchestrator } from './ai/types.js';
import type AIOrchestrator from './ai/AIOrchestrator.js';

// Register error handlers FIRST to catch any import failures
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown handlers for Browserbase session cleanup
async function gracefulShutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}, cleaning up...`);
  
  try {
    // Import session manager dynamically to avoid circular dependencies
    const { closeAllSessions } = await import('./lib/sessionManager.js');
    await closeAllSessions();
  } catch (error) {
    console.error('[SHUTDOWN] Error closing sessions:', error);
  }
  
  console.log('[SHUTDOWN] Cleanup complete, exiting');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

class SignupAssistMCPServer {
  private server: Server;
  private tools: Map<string, any> = new Map();
  private orchestrator: IOrchestrator | AIOrchestrator | null = null;

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
      const useAPIMode = process.env.USE_API_ORCHESTRATOR === 'true';
      
      if (useAPIMode) {
        console.log('[STARTUP] 🔵 API-FIRST MODE ENABLED - Loading APIOrchestrator...');
        const { default: APIOrchestrator } = await import('./ai/APIOrchestrator.js');
        console.log('[STARTUP] APIOrchestrator module loaded successfully');
        
        this.orchestrator = new APIOrchestrator(this); // Pass server instance for MCP tool access
        console.log('✅ [API-FIRST MODE] APIOrchestrator initialized with MCP tool access');
        console.log('✅ API-first providers: Bookeo (aim-design)');
        console.log('✅ No scraping, no prerequisites, no login required');
        console.log('✅ All API calls go through MCP layer for audit compliance');
        
      } else {
        console.log('[STARTUP] 🟡 LEGACY MODE - Loading AIOrchestrator...');
        const { default: AIOrchestrator } = await import('./ai/AIOrchestrator.js');
        console.log('[STARTUP] AIOrchestrator module loaded successfully');
        
        // Pass MCP tool caller to orchestrator (legacy mode only)
        const mcpToolCaller = async (toolName: string, args: any) => {
          if (!this.tools.has(toolName)) {
            const availableTools = Array.from(this.tools.keys()).join(', ');
            throw new Error(`Unknown MCP tool: ${toolName}. Available: ${availableTools}`);
          }
          const tool = this.tools.get(toolName);
          return await tool.handler(args);
        };
        
        this.orchestrator = new AIOrchestrator(mcpToolCaller);
        console.log('✅ [LEGACY MODE] AIOrchestrator initialized with MCP tool access');
        console.log(`✅ Available MCP tools: ${Array.from(this.tools.keys()).join(', ')}`);
      }
      
      console.log(`✅ Orchestrator mode: ${useAPIMode ? 'API-FIRST' : 'LEGACY (scraping)'}`);
      
    } catch (error) {
      console.error('❌ WARNING: Orchestrator failed to load - server will start without it');
      console.error('Error:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('Tip: Set OPENAI_API_KEY environment variable if using OpenAI');
      console.error('Tip: Set USE_API_ORCHESTRATOR=true for API-first mode (Bookeo)');
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
    // 🔔 Register page readiness helpers for each provider
    // REMINDER FOR FUTURE PROVIDERS:
    // Each time you add a new provider (e.g., campminder, leagueapps),
    // 1. Create mcp_server/providers/utils/<providerId>Readiness.ts
    // 2. Implement waitFor<ProviderName>Ready(page: Page)
    // 3. Register it here using registerReadiness("<id>", fn)
    registerReadiness("scp", waitForSkiClubProReady);
    
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

    // Register Bookeo tools
    bookeoTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register Stripe tools
    stripeTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register Mandate tools
    mandateTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register Scheduler tools
    schedulerTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register program feed (cache-first) tools
    Object.entries(programFeedTools).forEach(([name, tool]) => {
      this.tools.set(name, {
        name,
        description: `Program Feed tool: ${name}`,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register Registration tools (receipts/audit trail)
    registrationTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Register User tools (children, billing - ChatGPT App Store compliance)
    userTools.forEach((tool) => {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler
      });
    });

    // Future array tools (no-op for now)
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

    const httpServer = createServer(async (req, res) => {
      // --- CORS setup
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-run-id, X-Mandate-JWS, X-Mandate-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);
      console.log(`[REQUEST] ${req.method} ${url.pathname}`);

      // --- Bookeo API Helper (for deprecated legacy endpoints)
      // Extract Bookeo credentials once for all handlers
      const BOOKEO_API_KEY = process.env.BOOKEO_API_KEY;
      const BOOKEO_SECRET_KEY = process.env.BOOKEO_SECRET_KEY;
      
      /**
       * Build Bookeo API URL with query parameter authentication
       * This matches the working curl pattern and sync-bookeo edge function
       */
      function buildBookeoUrl(path: string, extra: Record<string, string> = {}): string {
        const url = new URL(`https://api.bookeo.com/v2${path}`);
        if (BOOKEO_API_KEY) url.searchParams.set("apiKey", BOOKEO_API_KEY);
        if (BOOKEO_SECRET_KEY) url.searchParams.set("secretKey", BOOKEO_SECRET_KEY);
        for (const [k, v] of Object.entries(extra)) {
          url.searchParams.set(k, v);
        }
        return url.toString();
      }

      // ==================== OAUTH PROXY ENDPOINTS ====================
      // These proxy Auth0 endpoints through Railway to satisfy GPT Builder's
      // same-domain requirement (all URLs must share the same root domain)
      
      const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'dev-xha4aa58ytpvlqyl.us.auth0.com';
      const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
      const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;
      const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://shipworx.ai/api';
      
      // --- OAuth Authorization Proxy (GET /oauth/authorize)
      // Redirects to Auth0 with all query params preserved
      if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
        console.log('[OAUTH] Authorization request received, proxying to Auth0');
        
        const auth0Url = new URL(`https://${AUTH0_DOMAIN}/authorize`);
        
        // Forward all query params from ChatGPT
        url.searchParams.forEach((value, key) => {
          auth0Url.searchParams.set(key, value);
        });
        
        // Ensure audience is set for API access
        if (!auth0Url.searchParams.has('audience')) {
          auth0Url.searchParams.set('audience', AUTH0_AUDIENCE);
        }
        
        console.log('[OAUTH] Redirecting to:', auth0Url.toString().replace(/client_secret=[^&]+/, 'client_secret=***'));
        
        res.writeHead(302, { 'Location': auth0Url.toString() });
        res.end();
        return;
      }
      
      // --- OAuth Token Proxy (POST /oauth/token)
      // Forwards token exchange request to Auth0
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        console.log('[OAUTH] Token exchange request received, proxying to Auth0');
        
        try {
          // Read request body
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          
          // Parse the body (could be JSON or form-urlencoded)
          let tokenParams: Record<string, string> = {};
          const contentType = req.headers['content-type'] || '';
          
          if (contentType.includes('application/json')) {
            tokenParams = JSON.parse(body);
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const parsed = new URLSearchParams(body);
            parsed.forEach((value, key) => {
              tokenParams[key] = value;
            });
          } else {
            // Try to parse as form-urlencoded by default
            const parsed = new URLSearchParams(body);
            parsed.forEach((value, key) => {
              tokenParams[key] = value;
            });
          }
          
          console.log('[OAUTH] Token request params (redacted):', {
            grant_type: tokenParams.grant_type,
            code: tokenParams.code ? '***' : undefined,
            redirect_uri: tokenParams.redirect_uri,
            client_id: tokenParams.client_id ? '***' : undefined
          });
          
          // Add client credentials if not provided (ChatGPT may not send them)
          if (!tokenParams.client_id && AUTH0_CLIENT_ID) {
            tokenParams.client_id = AUTH0_CLIENT_ID;
          }
          if (!tokenParams.client_secret && AUTH0_CLIENT_SECRET) {
            tokenParams.client_secret = AUTH0_CLIENT_SECRET;
          }
          
          // Forward to Auth0 token endpoint
          const auth0TokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
          
          const auth0Response = await fetch(auth0TokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(tokenParams)
          });
          
          const responseData = await auth0Response.text();
          
          console.log('[OAUTH] Auth0 token response status:', auth0Response.status);
          
          // Forward Auth0's response back to ChatGPT
          res.writeHead(auth0Response.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(responseData);
        } catch (error: any) {
          console.error('[OAUTH] Token exchange error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token exchange failed', details: error?.message }));
        }
        return;
      }
      
      // ==================== END OAUTH PROXY ENDPOINTS ====================

      // --- Health check endpoint
      if (req.method === 'GET' && url.pathname === '/health') {
        console.log('[HEALTH] check received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      
      // --- Keep-warm ping endpoint to prevent cold starts
      if (req.method === 'GET' && url.pathname === '/ping') {
        console.log('[PING] keep-warm request received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now() }));
        return;
      }

      // --- Identity endpoint for backend verification
      if (req.method === 'GET' && url.pathname === '/identity') {
        console.log('[IDENTITY] backend identity request received');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          env: process.env.NODE_ENV || 'unknown',
          git_commit: process.env.GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
          timestamp: new Date().toISOString(),
          backend: 'Railway Production MCP'
        }));
        return;
      }

      // --- Bookeo Debug Endpoint - Tests Bookeo API credentials from Railway
      if (req.method === 'GET' && url.pathname === '/bookeo-debug') {
        console.log('[DEBUG] Bookeo credentials test request received');
        
        try {
          const apiKey = process.env.BOOKEO_API_KEY;
          const secretKey = process.env.BOOKEO_SECRET_KEY;

          if (!apiKey || !secretKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: "Missing Bookeo API key or secret key in Railway environment variables"
            }));
            return;
          }

          // Build the Bookeo API URL EXACTLY like your working curl
          const debugUrl = new URL('https://api.bookeo.com/v2/settings/apikeyinfo');
          debugUrl.searchParams.set('apiKey', apiKey);
          debugUrl.searchParams.set('secretKey', secretKey);

          console.log('[DEBUG] Calling Bookeo:', debugUrl.toString().replace(secretKey, '***'));

          const r = await fetch(debugUrl, { method: 'GET' });
          const text = await r.text();

          console.log('[DEBUG] Bookeo response status:', r.status);
          console.log('[DEBUG] Bookeo response body:', text);

          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(text);
        } catch (err: any) {
          console.error('[DEBUG] Bookeo error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Unexpected failure' }));
        }
        return;
      }

      // ==================== BOOKEO BOOKING ENDPOINTS (DEPRECATED) ====================
      // These endpoints are now handled by MCP tools in mcp_server/providers/bookeo.ts
      // Kept for backward compatibility only
      
      // --- GET /list-programs - DEPRECATED: Use bookeo.find_programs tool instead
      if (req.method === 'GET' && url.pathname === '/list-programs') {
        console.log('[BOOKEO] List programs request received');
        
        try {
          const nowIso = new Date().toISOString();
          
          // Fetch programs from cached_provider_feed table
          const { data: programs, error } = await supabase
            .from('cached_provider_feed')
            .select('program_ref, program, org_ref, category')
            .eq('org_ref', 'bookeo-default')
            .order('cached_at', { ascending: false });
          
          if (error) {
            console.error('[BOOKEO] DB error on list-programs:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch programs' }));
            return;
          }
          
          if (!programs || programs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: "carousel", items: [] }));
            return;
          }
          
          // Transform programs into ChatGPT carousel format
          const carouselItems = programs
            .filter((p: any) => {
              const prog = p.program;
              // Filter for active, open programs with future dates
              const startTime = prog.next_available || prog.signup_start_time;
              return prog.status === 'Open' && 
                     prog.active !== false && 
                     startTime && 
                     new Date(startTime) > new Date();
            })
            .slice(0, 8) // Limit to 8 items per ChatGPT best practices
            .map((p: any) => {
              const prog = p.program;
              const startTime = prog.next_available || prog.signup_start_time;
              const seats = prog.max_participants || prog.available_slots || 0;
              const emoji = prog.emoji || '🎯';
              const price = prog.price || null;
              
              return {
                title: `${emoji} ${prog.title || prog.name}`,
                subtitle: `${new Date(startTime).toLocaleDateString()} @ ${new Date(startTime).toLocaleTimeString()} – ${seats} seats left`,
                image_url: prog.image_url || prog.imageUrl || prog.thumbnail || null,
                action: {
                  label: "Reserve Spot",
                  tool: "create_hold",
                  input: {
                    eventId: p.program_ref,
                    productId: p.program_ref.split('_')[0] || p.program_ref,
                    adults: 1,
                    children: 0,
                    firstName: "<YourFirstName>",
                    lastName: "<YourLastName>",
                    email: "you@example.com",
                    phone: "<YourPhone>"
                  }
                }
              };
            });
          
          console.log(`[BOOKEO] Returning carousel with ${carouselItems.length} programs`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: "carousel",
            items: carouselItems
          }));
        } catch (err: any) {
          console.error('[BOOKEO] Unexpected error on list-programs:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server error' }));
        }
        return;
      }
      
      // ==================== END BOOKEO ENDPOINTS ====================



      // --- Get user location via ipapi.co
      if (req.method === 'GET' && url.pathname === '/get-user-location') {
        console.log('[LOCATION] User location request received');
        
        try {
          const apiKey = process.env.IPAPI_KEY;

          if (!apiKey) {
            const env = (process.env.NODE_ENV || "").toLowerCase();
            const isDev = env === "development";

            if (!isDev) {
              console.error("[get-user-location] CRITICAL: IPAPI_KEY missing in production");
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: "IPAPI_KEY not configured",
                mock: true,
                reason: "missing_ipapi_key"
              }));
              return;
            }

            console.warn('[LOCATION] IPAPI_KEY not configured - returning mock Madison location for dev');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin",
              country: "US",
              mock: true,
              reason: "no_api_key"
            }));
            return;
          }

          // Extract client IP (Railway / proxies)
          let clientIp = req.headers['x-forwarded-for'] as string | undefined;
          if (Array.isArray(clientIp)) clientIp = clientIp[0];
          if (!clientIp) {
            clientIp = req.socket.remoteAddress;
          }

          // Strip IPv6 prefix "::ffff:"
          if (clientIp && clientIp.startsWith('::ffff:')) {
            clientIp = clientIp.replace('::ffff:', '');
          }

          // Handle localhost
          if (!clientIp || clientIp === '127.0.0.1' || clientIp === '::1') {
            console.log('[LOCATION] Localhost detected - returning mock location');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "localhost",
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          console.log(`[LOCATION] Looking up IP: ${clientIp}`);
          const apiUrl = `https://ipapi.co/${clientIp}/json/?key=${apiKey}`;
          const response = await fetch(apiUrl);

          if (!response.ok) {
            console.error(`[LOCATION] ipapi.co error: ${response.status}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "ipapi_http_error",
              status: response.status,
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          const data = await response.json();

          if (!data || data.error || data.latitude === undefined || data.longitude === undefined) {
            console.error('[LOCATION] Invalid ipapi.co response:', data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              mock: true,
              reason: "ipapi_invalid_response",
              lat: 43.0731,
              lng: -89.4012,
              city: "Madison",
              region: "Wisconsin"
            }));
            return;
          }

          console.log(`[LOCATION] ✅ Real location: ${data.city}, ${data.region}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            lat: data.latitude,
            lng: data.longitude,
            city: data.city,
            region: data.region,
            country: data.country_name,
            mock: false
          }));
        } catch (err: any) {
          console.error('[LOCATION] Exception:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            mock: true,
            reason: "ipapi_exception",
            error: err.message,
            lat: 43.0731,
            lng: -89.4012,
            city: "Madison",
            region: "Wisconsin"
          }));
        }
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

      // --- Serve OpenAPI spec at /mcp/openapi.json AND /openapi.json
      if (req.method === 'GET' && (url.pathname === '/mcp/openapi.json' || url.pathname === '/openapi.json')) {
        try {
          // Load openapi.json with fallback for Railway builds
          let openapiPath = path.resolve(process.cwd(), 'dist', 'mcp', 'openapi.json');
          if (!existsSync(openapiPath)) {
            // Fallback: use source copy
            openapiPath = path.resolve(process.cwd(), 'mcp', 'openapi.json');
          }
          if (!existsSync(openapiPath)) {
            // Last resort: try relative path
            openapiPath = './mcp/openapi.json';
          }
          console.log('[DEBUG] Using OpenAPI spec at:', openapiPath, 'exists:', existsSync(openapiPath));
          const spec = readFileSync(openapiPath, 'utf8');
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          res.end(spec);
          console.log('[ROUTE] Served', url.pathname);
        } catch (error: any) {
          console.error('[OPENAPI ERROR]', error);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'OpenAPI spec not found',
            details: error.message,
            cwd: process.cwd()
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

      // --- Credential storage endpoint
      if (url.pathname === '/tools/cred-store') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only POST supported' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { provider, alias, email, password, user_id } = JSON.parse(body);
            
            if (!provider || !alias || !email || !password) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Missing required fields: provider, alias, email, password' 
              }));
              return;
            }

            // Check for CRED_SEAL_KEY
            const sealKey = process.env.CRED_SEAL_KEY;
            if (!sealKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'CRED_SEAL_KEY not configured' }));
              return;
            }

            // Use system user ID if not provided (for service credentials)
            const SYSTEM_USER_ID = 'eb8616ca-a2fa-4849-aef6-723528d8c273';
            const effectiveUserId = user_id || SYSTEM_USER_ID;

            console.log(`[cred-store] Storing credential for provider=${provider}, alias=${alias}, user=${effectiveUserId}`);

            // Encrypt credentials using Web Crypto API (AES-GCM)
            const credentialData = JSON.stringify({ email, password });
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(credentialData);
            
            // Generate random IV (12 bytes for AES-GCM)
            const iv = crypto.randomBytes(12);
            
            // Import the encryption key
            const keyData = Buffer.from(sealKey, 'base64');
            const cryptoKey = await crypto.subtle.importKey(
              'raw',
              keyData,
              { name: 'AES-GCM', length: 256 },
              false,
              ['encrypt']
            );
            
            // Encrypt the data
            const encryptedBuffer = await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              cryptoKey,
              dataBuffer
            );
            
            // Format as base64:base64 (encrypted:iv)
            const encryptedBase64 = Buffer.from(encryptedBuffer).toString('base64');
            const ivBase64 = iv.toString('base64');
            const encryptedData = `${encryptedBase64}:${ivBase64}`;

            // Store in database using service role
            const supabaseUrl = process.env.SUPABASE_URL!;
            const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
            
            const { createClient } = await import('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseServiceKey);

            const { data, error } = await supabase
              .from('stored_credentials')
              .upsert(
                {
                  user_id: effectiveUserId,
                  provider,
                  alias,
                  encrypted_data: encryptedData,
                },
                { onConflict: 'user_id,provider', ignoreDuplicates: false }
              )
              .select()
              .single();

            if (error) {
              console.error('[cred-store] Database error:', error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Database error: ${error.message}` }));
              return;
            }

            console.log(`[cred-store] ✅ Stored credential with ID: ${data.id}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true,
              id: data.id,
              alias: data.alias,
              provider: data.provider,
              created_at: data.created_at
            }));
          } catch (err: any) {
            console.error('[cred-store] Error:', err);
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
          const manifestPath = path.resolve(process.cwd(), "public", ".well-known", "ai-plugin.json");
          const manifest = readFileSync(manifestPath, "utf8");
          res.writeHead(200, { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache"
          });
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
          const manifestPath = path.resolve(process.cwd(), "public", ".well-known", "openai-connector.json");
          const manifest = readFileSync(manifestPath, "utf8");
          res.writeHead(200, { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache"
          });
          res.end(manifest);
          console.log("[ROUTE] Served openai-connector.json for", url.pathname);
        } catch (error: any) {
          console.error("[CONNECTOR JSON ERROR]", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to load openai-connector.json", details: error.message }));
        }
        return;
      }

      // --- OpenAI Domain Verification (for ChatGPT app submission)
      if (
        req.method === "GET" &&
        (url.pathname === "/.well-known/openai-verification.txt" ||
         url.pathname === "/mcp/.well-known/openai-verification.txt")
      ) {
        const verificationToken = process.env.OPENAI_VERIFICATION_TOKEN || '';
        if (!verificationToken) {
          console.warn("[ROUTE] OPENAI_VERIFICATION_TOKEN not set");
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(verificationToken);
        console.log("[ROUTE] Served openai-verification.txt for", url.pathname);
        return;
      }

      // --- Prompt override endpoint for tone training
      if (url.pathname === '/api/override-prompt') {
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
            const { sessionId, newPrompt } = JSON.parse(body);
            
            if (!sessionId || !newPrompt) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId or newPrompt' }));
              return;
            }
            
            if (!this.orchestrator) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'AI Orchestrator unavailable' }));
              return;
            }
            
            // overridePrompt is only available in legacy AIOrchestrator
            const isAPIMode = process.env.USE_API_ORCHESTRATOR === 'true';
            if (isAPIMode) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Prompt override not supported in API-first mode' }));
              return;
            }
            
            (this.orchestrator as any).overridePrompt(sessionId, newPrompt);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: `Prompt overridden for session ${sessionId}` 
            }));
          } catch (err: any) {
            console.error('[Override Prompt] Error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unknown error' }));
          }
        });
        return;
      }

      // --- Identity endpoint (helps Supabase functions auto-detect worker URL)
      if (req.method === 'GET' && url.pathname === '/identity') {
        const host = req.headers['host'];
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const workerUrl = `${protocol}://${host}`;
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ worker_url: workerUrl }));
        console.log('[IDENTITY] Served worker URL:', workerUrl);
        return;
      }

      // --- Refresh programs feed (triggers Blackhawk scraping)
      if (req.method === 'POST' && url.pathname === '/refresh-feed') {
        const timestamp = new Date().toISOString();
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        
        console.log('[REFRESH-FEED] ⚠️ Feed refresh request received', {
          timestamp,
          clientIp,
          userAgent,
          headers: JSON.stringify(req.headers)
        });
        
        // Only allow internal authorized calls using worker service token
        const authHeader = req.headers['authorization'] as string | undefined;
        const workerToken = process.env.WORKER_SERVICE_TOKEN;
        
        if (!workerToken || authHeader !== `Bearer ${workerToken}`) {
          console.warn('❌ Unauthorized /refresh-feed call (bad token)');
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }
        
        try {
          const orgRef = 'blackhawk-ski-club'; // Could be extracted from query/body in future
          console.log(`[RefreshFeed] 🔄 Initiating program feed refresh for "${orgRef}"`);
          
          // Import telemetry dynamically to avoid issues
          const { telemetry } = await import('./lib/telemetry.js');
          telemetry.record('feed_refresh', { provider: 'blackhawk', action: 'start' });
          
          const programsCount = await refreshBlackhawkPrograms();  // Run full refresh for Blackhawk Ski Club
          
          telemetry.record('feed_refresh', { provider: 'blackhawk', status: 'success', programs_count: programsCount });
          console.log(`[RefreshFeed] ✅ Refresh complete: ${programsCount} programs cached for ${orgRef}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `Refreshed ${programsCount} programs for ${orgRef}.`, refreshed: programsCount }));
        } catch (err: any) {
          console.error('[RefreshFeed] ❌ Feed refresh failed:', err.message);
          const { telemetry } = await import('./lib/telemetry.js');
          telemetry.record('feed_refresh', { provider: 'blackhawk', status: 'failed', error: err.message });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message || 'Unknown error' }));
        }
        return;
      }

      // --- Hydrate program details (triggers detail page scraping for specific programs)
      if (req.method === 'POST' && url.pathname === '/hydrate-program-details') {
        const timestamp = new Date().toISOString();
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        
        console.log('[HYDRATE-DETAILS] Detail hydration request received', {
          timestamp,
          clientIp
        });
        
        // Require internal authorization token
        const authHeader = req.headers['authorization'] as string | undefined;
        const mcpToken = process.env.MCP_ACCESS_TOKEN;
        
        if (!mcpToken || authHeader !== `Bearer ${mcpToken}`) {
          console.warn('❌ Unauthorized /hydrate-program-details call (bad token)');
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { provider = 'blackhawk', program_refs } = JSON.parse(body || '{}');
            
            if (provider !== 'blackhawk') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unsupported provider' }));
              return;
            }
            
            // Import functions dynamically
            const { refreshBlackhawkProgramDetail } = await import('./providers/blackhawk.js');
            const { createClient } = await import('@supabase/supabase-js');
            
            const supabaseUrl = process.env.SUPABASE_URL!;
            const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            
            // Determine target program refs (either provided or all not yet hydrated)
            let targetRefs: string[];
            if (program_refs) {
              targetRefs = Array.isArray(program_refs) ? program_refs : [program_refs];
            } else {
              const { data: feedCache } = await supabase
                .from('cached_programs')
                .select('programs_by_theme')
                .eq('org_ref', 'blackhawk-ski-club')
                .eq('category', 'all')
                .single();
                
              if (!feedCache) throw new Error('No feed cache found');
              
              const allPrograms: any[] = [];
              for (const progs of Object.values(feedCache.programs_by_theme)) {
                allPrograms.push(...(progs as any[]));
              }
              
              const allRefs = allPrograms.map((p: any) => p.program_ref);
              
              const { data: detailCache } = await supabase
                .from('cached_provider_feed')
                .select('program_ref')
                .eq('org_ref', 'blackhawk-ski-club');
                
              const cachedRefs = new Set((detailCache || []).map((item: any) => item.program_ref));
              targetRefs = allRefs.filter(ref => !cachedRefs.has(ref));
            }
            
            // Hydrate each uncached program detail
            let count = 0;
            const errors: Array<{ program_ref: string; error: string }> = [];
            
            for (const ref of targetRefs) {
              try {
                await refreshBlackhawkProgramDetail(ref);
                count++;
              } catch (err: any) {
                console.error(`Error hydrating details for ${ref}:`, err);
                errors.push({ program_ref: ref, error: err.message });
              }
            }
            
            console.log(`[HYDRATE-DETAILS] ✅ Hydrated ${count}/${targetRefs.length} programs`);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              provider: 'blackhawk', 
              hydrated: count,
              total: targetRefs.length,
              errors: errors.length > 0 ? errors : undefined
            }));
          } catch (err: any) {
            console.error('[HYDRATE-DETAILS] ❌ Hydration failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }

      // --- Orchestrator endpoint for Chat Test Harness
      // Version endpoint for deployment verification
      if (url.pathname === '/version') {
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(VERSION_INFO, null, 2));
        return;
      }

      if (url.pathname === '/orchestrator/chat') {
        console.log('[ROUTE] /orchestrator/chat hit');
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mandate-JWS, X-Mandate-Id'
          });
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
            const parsedBody = JSON.parse(body);
            const { message, sessionId, action, payload, userLocation, userJwt, category, childAge, currentAAP, userTimezone, user_id } = parsedBody;
            
            console.log('[Orchestrator] Request params:', { 
              hasMessage: !!message,
              hasAction: !!action,
              hasAAP: !!currentAAP,
              hasCategory: !!category,
              hasChildAge: !!childAge,
              hasLocation: !!(userLocation?.lat && userLocation?.lng),
              location: userLocation,
              userTimezone
            });
            
            // ================================================================
            // AUTH0 JWT VERIFICATION (Production ChatGPT App Store Flow)
            // ================================================================
            const authHeader = req.headers['authorization'] as string | undefined;
            const bearerToken = extractBearerToken(authHeader);
            
            let authenticatedUserId: string | null = null;
            let authSource: 'auth0' | 'test_harness' | 'none' = 'none';
            
            // Production: Verify Auth0 JWT if present
            if (bearerToken) {
              try {
                const payload = await verifyAuth0Token(bearerToken);
                authenticatedUserId = payload.sub;
                authSource = 'auth0';
                console.log('[AUTH] ✅ Auth0 JWT verified, user_id:', authenticatedUserId);
              } catch (jwtError: any) {
                console.warn('[AUTH] ⚠️ Auth0 JWT verification failed:', jwtError.message);
                // JWT invalid - fall through to check test harness user_id
              }
            }
            
            // Test harness fallback: Accept user_id from body (only if no valid Auth0 token)
            if (!authenticatedUserId && user_id) {
              authenticatedUserId = user_id;
              authSource = 'test_harness';
              console.log('[AUTH] Using test harness user_id:', authenticatedUserId);
            }
            
            // ================================================================
            // PROTECTED ACTION ENFORCEMENT
            // Return 401 for protected actions without authentication
            // ChatGPT SDK interprets this as "trigger OAuth consent"
            // ================================================================
            if (action && isProtectedAction(action) && !authenticatedUserId) {
              console.log('[AUTH] 🚫 Protected action without auth:', action);
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'WWW-Authenticate': `Bearer realm="SignupAssist", error="authentication_required"`
              });
              res.end(JSON.stringify({
                error: 'authentication_required',
                message: 'Sign in required to perform this action',
                action_requiring_auth: action,
                protected_actions: PROTECTED_ACTIONS as unknown as string[]
              }));
              return;
            }
            
            // Use authenticated user_id for downstream operations
            const finalUserId = authenticatedUserId;
            console.log('[AUTH] Final user context:', { userId: finalUserId, authSource });
            
            // Capture mandate from headers or body (with dev bypass)
            const mandate_jws = (req.headers['x-mandate-jws'] as string) 
                             || parsedBody.mandate_jws 
                             || process.env.MANDATE_JWS_DEV 
                             || null;
            const mandate_id = (req.headers['x-mandate-id'] as string) 
                            || parsedBody.mandate_id 
                            || null;
            
            // Dev bypass if no mandate in dev mode
            const finalMandateJws = (!mandate_jws && process.env.MANDATE_OPTIONAL === 'true') 
              ? '__DEV_BYPASS__' 
              : mandate_jws;
            
            if (finalMandateJws || mandate_id) {
              console.log('[mandate] attached:', !!finalMandateJws, !!mandate_id);
            }
            
            // Check if orchestrator is available - if not, provide mock responses
            if (!this.orchestrator) {
              console.warn('[Orchestrator] AI Orchestrator unavailable - using mock responses');
              
              // Simple mock responses for testing UI without OpenAI
              let mockResult;
              
              if (action === 'provider_selected' || action === 'confirm_provider') {
                mockResult = {
                  message: "Great! I'll connect to your account to check available programs.",
                  cards: [{
                    title: "Connect Account",
                    description: "To continue, please log in to your account.",
                    buttons: [{
                      label: "Connect Account",
                      action: "show_login_dialog",
                      variant: "accent"
                    }]
                  }],
                  contextUpdates: { 
                    step: 'login',
                    provider: payload?.provider || 'skiclubpro',
                    orgRef: payload?.orgRef 
                  }
                };
              } else if (message && message.toLowerCase().includes('blackhawk')) {
                mockResult = {
                  message: "I found **Blackhawk Ski Club** in Middleton, WI. Is that the one you mean?",
                  cards: [{
                    title: "Blackhawk Ski Club",
                    subtitle: "Middleton, WI",
                    buttons: [{
                      label: "Yes, that's it",
                      action: "confirm_provider",
                      variant: "accent"
                    }, {
                      label: "Show me others",
                      action: "show_alternatives",
                      variant: "outline"
                    }]
                  }]
                };
              } else {
                mockResult = {
                  message: "⚠️ Mock mode: OPENAI_API_KEY not configured.\n\nTo enable full AI orchestration, set OPENAI_API_KEY in your Railway environment variables.\n\nFor now, try typing 'blackhawk' to test the mock flow.",
                  cta: [{
                    label: "Documentation",
                    action: "view_docs",
                    variant: "outline"
                  }]
                };
              }
              
              res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify(mockResult));
              return;
            }
            
            // Validate required fields
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId' }));
              return;
            }

            let result;
            
            // Check orchestrator mode
            const isAPIMode = process.env.USE_API_ORCHESTRATOR === 'true';
            
            // Route to appropriate orchestrator method
            if (action) {
              // Card action (button click)
              console.log(`[Orchestrator] handleAction: ${action}`, { hasJwt: !!userJwt });
              
              if (isAPIMode) {
                // APIOrchestrator: Use generateResponse with action parameter
                console.log('[API-FIRST MODE] Routing action via generateResponse', { finalUserId });
                result = await (this.orchestrator as any).generateResponse('', sessionId, action, payload || {}, userTimezone, finalUserId);
              } else {
                // Legacy AIOrchestrator: Use handleAction method
                try {
                  console.log('[LEGACY MODE] Calling AIOrchestrator.handleAction');
                  result = await (this.orchestrator as any).handleAction(action, payload || {}, sessionId, userJwt, { 
                    mandate_jws: finalMandateJws, 
                    mandate_id 
                  });
                  console.log(`[Orchestrator] handleAction result:`, result ? 'success' : 'null/undefined');
                  
                  if (!result) {
                    throw new Error(`handleAction returned ${result} for action: ${action}`);
                  }
                } catch (actionError: any) {
                  console.error(`[Orchestrator] handleAction error for ${action}:`, actionError);
                  throw actionError; // Re-throw to outer catch
                }
              }
            } else if (message) {
              // Fetch ipapi location if not already provided via userLocation
              let finalUserLocation = userLocation;
              
              // Only fetch location and update context in legacy mode
              // (isAPIMode already declared above)
              
              if (!isAPIMode && (!userLocation?.lat || !userLocation?.lng)) {
                try {
                  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SB_URL;
                  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
                  
                  if (SUPABASE_URL && SUPABASE_KEY) {
                    console.log('[Orchestrator] Fetching ipapi location...');
                    
                    // Forward client IP headers to ipapi function
                    const locationRes = await fetch(`${SUPABASE_URL}/functions/v1/get-user-location`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        // Forward IP headers from original request
                        ...(req.headers['x-forwarded-for'] && { 'x-forwarded-for': req.headers['x-forwarded-for'] as string }),
                        ...(req.headers['x-real-ip'] && { 'x-real-ip': req.headers['x-real-ip'] as string }),
                        ...(req.headers['cf-connecting-ip'] && { 'cf-connecting-ip': req.headers['cf-connecting-ip'] as string })
                      }
                    });
                    
                    if (locationRes.ok) {
                      const locationData = await locationRes.json();
                      console.log('[Orchestrator] ipapi location:', locationData);
                      
                      // Store in session context for AAP triage and provider search (legacy only)
                      await (this.orchestrator as any).updateContext(sessionId, {
                        location: {
                          lat: locationData.lat,
                          lng: locationData.lng,
                          city: locationData.city,
                          region: locationData.region,
                          country: 'US',
                          source: 'ipapi',
                          mock: locationData.mock || false,
                          reason: locationData.reason
                        }
                      } as any);
                      
                      // Also pass as userLocation for backward compatibility
                      finalUserLocation = { lat: locationData.lat, lng: locationData.lng };
                    }
                  }
                } catch (locationError: any) {
                  console.warn('[Orchestrator] Failed to fetch ipapi location:', locationError.message);
                  // Continue without location - not a critical failure
                }
              }
              
              // Phase 3: Update context with structured AAP if provided (legacy only)
              if (!isAPIMode && currentAAP) {
                console.log(`[Orchestrator] Updating context with AAP object:`, currentAAP);
                await (this.orchestrator as any).updateContext(sessionId, { aap: currentAAP } as any);
              }
              
              // Quick Win #1: Capture intent parameters (category, childAge) from request (legacy only)
              if (!isAPIMode && (category || childAge)) {
                console.log(`[Orchestrator] Updating context with legacy intent:`, { category, childAge });
                await (this.orchestrator as any).updateContext(sessionId, { category, childAge } as any);
              }
              
              // Text message
              console.log(`[Orchestrator] generateResponse: ${message}`, { 
                hasLocation: !!finalUserLocation, 
                hasJwt: !!userJwt,
                hasAAP: !!currentAAP,
                category,
                childAge 
              });
              
              // Use isAPIMode declared above (no redeclaration)
              
              if (isAPIMode) {
                // APIOrchestrator: Simple signature (input, sessionId, action?, payload?, userTimezone?, userId?)
                console.log('[API-FIRST MODE] Calling APIOrchestrator.generateResponse', { finalUserId });
                result = await (this.orchestrator as any).generateResponse(message, sessionId, undefined, undefined, userTimezone, finalUserId);
              } else {
                // Legacy AIOrchestrator: Complex signature with location, JWT, mandate
                console.log('[LEGACY MODE] Calling AIOrchestrator.generateResponse');
                result = await (this.orchestrator as any).generateResponse(
                  message, 
                  sessionId, 
                  finalUserLocation, 
                  userJwt, 
                  { 
                    mandate_jws: finalMandateJws, 
                    mandate_id 
                  }
                );
              }
              
              console.log(`[Orchestrator] generateResponse result:`, result ? 'success' : 'null/undefined');
              
              // Handle null response (silent pass for LOW confidence anonymous users)
              if (!result) {
                console.log('[Orchestrator] generateResponse returned null - silent pass (not activating for this query)');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  message: null,
                  silentPass: true 
                }));
                return;
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing message or action' }));
              return;
            }

            console.log(`[Orchestrator] Sending response:`, JSON.stringify(result).substring(0, 200));

            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('[Orchestrator] Error:', err);
            res.writeHead(500, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
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

// Log build info for deployment verification
console.info(
  `[BUILD] Commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || "dev"} | Built at: ${new Date().toISOString()}`
);

console.log('[STARTUP] Creating SignupAssistMCPServer instance...');
const server = new SignupAssistMCPServer();

console.log('[STARTUP] Initializing AIOrchestrator asynchronously...');
await server.initializeOrchestrator();
console.log('[STARTUP] AIOrchestrator initialization complete');

// Run OpenAI smoke tests to verify API configuration
console.log('[STARTUP] Running OpenAI smoke tests...');
try {
  await runOpenAISmokeTests({ failFast: false });
} catch (error) {
  console.warn('[STARTUP] OpenAI smoke tests failed (non-fatal):', error);
}

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
    .then(async (httpServer) => {
      const bootTime = Date.now() - startTime;
      console.log('[STARTUP] ✅ HTTP server fully operational');
      console.log('[STARTUP] Boot time:', bootTime, 'ms');
      console.log('[STARTUP] Process uptime:', process.uptime().toFixed(2), 'seconds');
      console.log('[STARTUP] Memory usage:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');
      
      // DISABLED: Provider cache preloading was creating unnecessary Browserbase sessions
      // try {
      //   await preloadProviderCache();
      // } catch (error) {
      //   console.warn('[STARTUP] Provider cache preload failed (non-fatal):', error);
      // }
      
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
