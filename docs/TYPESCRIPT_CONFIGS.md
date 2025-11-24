# TypeScript Configuration Architecture

This project uses a **multi-config setup** with TypeScript project references.

## Config Files

### `tsconfig.json` (Root)
- References all other configs
- Defines shared path aliases (`@/*` → `./src/*`)
- **Do not compile with this directly**

### `tsconfig.mcp.json` (Backend)
- Compiles MCP server: `mcp_server/`, `providers/`, `mcp/`
- Target: ES2022, Module: ES2022
- Output: `dist/`
- Usage: `tsc -p tsconfig.mcp.json`

### `tsconfig.app.json` (Frontend)
- Compiles React app: `src/`
- Used by Vite during `vite build`
- Target: ES2020, JSX: react-jsx

### `tsconfig.node.json` (Vite Tooling)
- Compiles Vite config: `vite.config.ts`
- Required by Vite during build
- Target: ES2022

### `tsconfig.scripts.json` (Scripts)
- Compiles scripts in `scripts/`
- Module: CommonJS for Node.js compatibility

## Dockerfile Requirements

**CRITICAL**: The Dockerfile MUST copy ALL tsconfig files:
```dockerfile
COPY tsconfig*.json ./
```

Failure to include any config will cause ENOENT errors during builds.

## Troubleshooting

### Error: Cannot find tsconfig.*.json

If you see:
```
Error: ENOENT: no such file or directory, open '/app/tsconfig.node.json'
```

**Solution**: Verify Dockerfile contains `COPY tsconfig*.json ./` before any build commands.
