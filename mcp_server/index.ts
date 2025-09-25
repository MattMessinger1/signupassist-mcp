/**
 * MCP Server - Registers all MCP tools with the framework
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Import tool providers
import { skiClubProTools } from './providers/skiclubpro';
import { daysmartTools } from '../providers/daysmart/index';
import { campminderTools } from '../providers/campminder/index';

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
      ...daysmartTools,
      ...campminderTools,
    ];

    arrayTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('SignupAssist MCP Server started');
  }
}

// Start the server
const server = new SignupAssistMCPServer();
server.start().catch(console.error);