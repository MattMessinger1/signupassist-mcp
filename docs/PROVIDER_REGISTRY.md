# Provider Registry System

## Overview

The provider registry system enables multi-provider support throughout SignupAssist. It provides a centralized configuration system where new API-based providers can be added with minimal code changes. All providers must integrate via official APIs -- web scraping is not supported.

## Architecture

### Core Components

1. **Provider Registry** (`mcp_server/providers/registry.ts`)
   - Central registry for all provider configurations
   - Defines `ProviderConfig` interface
   - Functions: `registerProvider()`, `getProvider()`, `getAllProviders()`

2. **Organization Registry** (`mcp_server/config/organizations.ts`)
   - Manages all organizations across all providers
   - Defines `OrgConfig` interface
   - Functions: `registerOrganization()`, `getOrganization()`, `getAllActiveOrganizations()`

3. **Provider Configurations** (`mcp_server/providers/{provider}/config.ts`)
   - Provider-specific implementations
   - Auto-registers on import

### Key Interfaces

#### ProviderConfig
```typescript
interface ProviderConfig {
  id: string;
  name: string;
  tools: {
    findPrograms: string;
    discoverFields: string;
  };
  syncConfig: {
    supportsAutomatedSync: boolean;
    method: 'edge-function' | 'mcp-tool';
    functionName?: string;
    requiresAuth?: boolean;
  };
  generateDeepLinks(orgRef: string, programRef: string): Record<string, string>;
  determineTheme(title: string): string;
}
```

#### OrgConfig
```typescript
interface OrgConfig {
  orgRef: string;
  providerId: string;
  displayName: string;
  category: string;
}
```

## Adding a New Provider

### Step 1: Create Provider Configuration

Create `mcp_server/providers/{provider}/config.ts`:

```typescript
import { registerProvider } from '../registry.js';

registerProvider({
  id: 'newprovider',
  name: 'New Provider',
  tools: {
    findPrograms: 'np.find_programs',
    discoverFields: 'np.discover_required_fields'
  },
  syncConfig: {
    supportsAutomatedSync: true,
    method: 'edge-function',
    functionName: 'sync-newprovider',
    requiresAuth: false
  },
  generateDeepLinks: (orgRef, programRef) => ({
    registration_start: `https://newprovider.com/${orgRef}/${programRef}/register`,
    program_details: `https://newprovider.com/${orgRef}/${programRef}`
  }),
  determineTheme: (title) => {
    if (title.toLowerCase().includes('lesson')) return 'Lessons';
    return 'All Programs';
  }
});
```

### Step 2: Register Organizations

```typescript
registerOrganization({
  orgRef: 'example-org',
  providerId: 'newprovider',
  displayName: 'Example Organization',
  category: 'all'
});
```

### Step 3: Implement Provider Tools

Create `mcp_server/providers/newprovider.ts` with API-based tools:
- `np.find_programs` -- program discovery via provider API
- `np.discover_required_fields` -- field discovery via provider API

### Step 4: Environment Variables

Add to `.env`:
```bash
NEWPROVIDER_API_KEY=your-api-key
NEWPROVIDER_SECRET_KEY=your-secret-key
```

API keys must be stored server-side only and never committed to source control.

## Current Providers

### Bookeo (Active)
- **Config**: `mcp_server/providers/bookeo/config.ts`
- **Tools**: `bookeo.find_programs`, `bookeo.discover_required_fields`
- **Integration**: API-based with automated sync
- **Organizations**: AIM Design

## Cache Refresh Flow

1. **Load Organizations**: `getAllActiveOrganizations()` loads all active orgs
2. **Provider Lookup**: For each org, `getProvider(org.providerId)` retrieves config
3. **API Call**: Uses provider API to fetch programs
4. **Deep Links**: Generates using `providerConfig.generateDeepLinks()`
5. **Theme Detection**: Categorizes using `providerConfig.determineTheme()`
6. **Database Storage**: Saves with `provider` column for multi-provider support

## Security

- Provider API keys are stored in environment variables, never in source code
- API keys are passed via HTTP headers (not query strings) where possible
- No provider login credentials are stored by SignupAssist
- All provider communication uses HTTPS
