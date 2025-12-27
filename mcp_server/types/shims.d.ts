// Minimal shims for environments where some third-party type declarations are unavailable.
// Node globals/types come from tsconfig.mcp.json ("types": ["node"]).

// In this repo we intentionally keep `tsconfig.mcp.json` independent of node_modules typings
// for IDE/lint contexts, so we provide lightweight Node-like globals here.

declare const process: {
  env: Record<string, string | undefined>;
  version?: string;
  cwd(): string;
  exit(code?: number): never;
  uptime(): number;
  memoryUsage(): any;
  on(event: string, listener: (...args: any[]) => void): any;
};

declare const Buffer: any;

declare module 'http' { export const createServer: any; }
declare module 'url' { export const URL: any; export const fileURLToPath: any; }
declare module 'fs' { export const readFileSync: any; export const existsSync: any; }
declare module 'path' {
  export const dirname: any;
  export const resolve: any;
  export const join: any;
  export const extname: any;
}
declare module 'crypto' {
  export const randomUUID: any;
  export const createHash: any;
  export const randomBytes: any;
  export const subtle: any;
}

declare module 'zod' { export const z: any; }
declare module '@modelcontextprotocol/sdk/server/index.js' { export const Server: any; }
declare module '@modelcontextprotocol/sdk/server/stdio.js' { export const StdioServerTransport: any; }
declare module '@modelcontextprotocol/sdk/server/sse.js' { export const SSEServerTransport: any; }
declare module '@modelcontextprotocol/sdk/types.js' {
  export const CallToolRequestSchema: any;
  export const ListToolsRequestSchema: any;
  export const ErrorCode: any;
  export const McpError: any;
}

declare module '@supabase/supabase-js' {
  export function createClient(...args: any[]): any;
}

declare module 'date-fns-tz' {
  export function formatInTimeZone(...args: any[]): string;
}


