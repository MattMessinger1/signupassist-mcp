/**
 * MCP Server - Registers all MCP tools with the framework
 * Production-ready with HTTP endpoints, CORS, and health checks
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
import { URL } from 'url';

// Import tool providers
import { skiClubProTools } from './providers/skiclubpro.js';
// import { daysmartTools } from '../providers/daysmart/index';
// import { campminderTools } from '../providers/campminder/index';

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
      return {
        tools: Array.from(this.tools.values()),
      };
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
    // Register SkiClubPro tools (object format)
    Object.entries(skiClubProTools).forEach(([name, handler]) => {
      this.tools.set(name, {
        name,
        description: `SkiClubPro provider tool: ${name}`,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: true
        },
        handler
      });
    });

    // Register other provider tools (array format)
    const arrayTools = [
      // Only SkiClubPro tools are active
    ];

    arrayTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });
  }

  getToolsList() {
    return Array.from(this.tools.keys());
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('SignupAssist MCP Server started');
  }

  async startHTTP() {
    const port = parseInt(process.env.PORT ?? "4000", 10);
    
    const httpServer = createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url!, `http://localhost:${port}`);
      
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          tools: this.getToolsList()
        }));
        return;
      }

      if (url.pathname === '/tools/call') {
        if (req.method === 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'This endpoint only supports POST. Use POST with { tool, args }.' 
          }));
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              let parsedBody;
              try {
                parsedBody = JSON.parse(body);
              } catch (parseError) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: 'Invalid JSON in request body' 
                }));
                return;
              }

              const { tool, args } = parsedBody;
              
              if (!tool) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: 'Missing required field: tool' 
                }));
                return;
              }
              
              if (!this.tools.has(tool)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: `Tool '${tool}' not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}` 
                }));
                return;
              }

              const toolInstance = this.tools.get(tool);
              const result = await toolInstance.handler(args || {});
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (error) {
              console.error('Tool execution error:', error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: error instanceof Error ? error.message : 'Unknown error' 
              }));
            }
          });
          return;
        }

        // Method not allowed for /tools/call
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: `Method ${req.method} not allowed. This endpoint only supports POST.` 
        }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tools: Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description
          }))
        }));
        return;
      }

      // Default response for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    httpServer.listen(port, () => {
      console.log(`MCP Server listening on port ${port}`);
      console.log(`Health check available at http://localhost:${port}/health`);
    });
  }
}

// Start both stdio and HTTP servers
const server = new SignupAssistMCPServer();

// Start HTTP server for production/Railway
if (process.env.NODE_ENV === 'production' || process.env.PORT) {
  server.startHTTP().catch(console.error);
} else {
  // Start stdio server for local MCP development
  server.start().catch(console.error);
}