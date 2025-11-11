# Provider Registry System

## Overview

The provider registry system enables multi-provider support throughout SignupAssist. It provides a centralized configuration system where new providers (SkiClubPro, CampMinder, DaySmart, etc.) can be added with minimal code changes.

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
   - Examples: `skiclubpro/config.ts`, `campminder/config.ts`

### Key Interfaces

#### ProviderConfig
```typescript
interface ProviderConfig {
  id: string;              // 'skiclubpro', 'campminder', etc.
  name: string;            // Display name
  urlPattern: 'subdomain' | 'path' | 'custom';
  
  tools: {
    findPrograms: string;  // MCP tool name
    discoverFields: string;
  };
  
  // Behavior functions
  buildBaseUrl(orgRef: string, customDomain?: string): string;
  generateDeepLinks(orgRef: string, programRef: string): Record<string, string>;
  loadSelectors(orgRef: string): Promise<SelectorSet>;
  determineTheme(title: string): string;
}
```

#### OrgConfig
```typescript
interface OrgConfig {
  orgRef: string;
  provider: string;
  displayName: string;
  categories: string[];
  customDomain?: string;
  credentialId?: string;
  priority: 'high' | 'normal' | 'low';
  active: boolean;
}
```

## Adding a New Provider

### Step 1: Create Provider Configuration

Create `mcp_server/providers/{provider}/config.ts`:

```typescript
import { registerProvider } from '../registry.js';

async function loadSelectors(orgRef: string) {
  return {
    container: ['.program-card', '.listing'],
    title: ['.program-title', 'h3'],
    price: ['.price-display'],
    // ...provider-specific selectors
  };
}

function determineTheme(title: string): string {
  // Provider-specific categorization logic
  if (title.includes('lesson')) return 'Lessons';
  return 'All Programs';
}

function buildBaseUrl(orgRef: string, customDomain?: string): string {
  return customDomain ? `https://${customDomain}` : `https://${orgRef}.provider.com`;
}

function generateDeepLinks(orgRef: string, programRef: string) {
  const base = buildBaseUrl(orgRef);
  return {
    registration_start: `${base}/register/${programRef}`,
    account_creation: `${base}/account/create`,
    program_details: `${base}/programs/${programRef}`
  };
}

registerProvider({
  id: 'newprovider',
  name: 'New Provider',
  urlPattern: 'subdomain',
  tools: {
    findPrograms: 'np.find_programs',
    discoverFields: 'np.discover_required_fields'
  },
  buildBaseUrl,
  generateDeepLinks,
  loadSelectors,
  determineTheme
});
```

### Step 2: Register Organizations

Add to `mcp_server/config/organizations.ts`:

```typescript
registerOrganization({
  orgRef: 'example-org',
  provider: 'newprovider',
  displayName: 'Example Organization',
  categories: ['all', 'category1', 'category2'],
  credentialId: process.env.NEWPROVIDER_SERVICE_CRED_ID,
  priority: 'high',
  active: true
});
```

### Step 3: Import Provider Config

Add to `mcp_server/index.ts`:

```typescript
import './providers/newprovider/config.js';
```

### Step 4: Implement Provider Tools

Create `mcp_server/providers/newprovider.ts` with tools:
- `np.find_programs` - Program discovery
- `np.discover_required_fields` - Field discovery

### Step 5: Environment Variables

Add to `.env`:
```bash
NEWPROVIDER_SERVICE_CRED_ID=uuid-here
NEWPROVIDER_ENABLED=true
```

## How It Works

### Cache Refresh Flow

1. **Load Organizations**: `getAllActiveOrganizations()` loads all active orgs from registry
2. **Provider Lookup**: For each org, `getProvider(org.provider)` retrieves provider config
3. **Tool Invocation**: Uses provider-specific tool names (`providerConfig.tools.findPrograms`)
4. **Deep Links**: Generates using `providerConfig.generateDeepLinks()`
5. **Theme Detection**: Categorizes using `providerConfig.determineTheme()`
6. **Database Storage**: Saves with `provider` column for multi-provider support

### Database Schema

The `cached_programs` table includes:
```sql
-- Provider identifier column
provider TEXT NOT NULL DEFAULT 'skiclubpro'

-- Composite unique constraint
UNIQUE (cache_key, provider)

-- Indexes for performance
INDEX idx_cached_programs_provider ON (provider)
INDEX idx_cached_programs_org_provider ON (org_ref, provider)
```

### RPC Functions

Updated to be provider-aware:

```sql
-- Find cached programs (provider-aware)
find_programs_cached(
  p_org_ref TEXT,
  p_category TEXT,
  p_provider TEXT DEFAULT 'skiclubpro',
  p_max_age_hours INTEGER DEFAULT 24
)

-- Upsert cached programs (provider-aware)
upsert_cached_programs_enhanced(
  p_org_ref TEXT,
  p_category TEXT,
  p_programs_by_theme JSONB,
  p_provider TEXT DEFAULT 'skiclubpro',
  ...
)
```

## Benefits

✅ **Easy Provider Addition**: New providers = single config file + registration
✅ **No Edge Function Changes**: `refresh-program-cache` works for all providers
✅ **Provider-Specific Behavior**: Custom URL patterns, selectors, themes per provider
✅ **Feature Flags**: Enable/disable providers with environment variables
✅ **Type Safety**: TypeScript interfaces ensure consistent implementations
✅ **Scalable**: Add 10+ providers without modifying core logic

## Testing a New Provider

1. Create provider config and register it
2. Add test organization with `active: false`
3. Implement provider tools
4. Test manually with `active: true`
5. Add more organizations once validated

## Example: Existing Providers

### SkiClubPro
- **Config**: `mcp_server/providers/skiclubpro/config.ts`
- **Tools**: `scp.find_programs`, `scp.discover_required_fields`
- **URL Pattern**: Subdomain (`orgref.skiclubpro.team`)
- **Organizations**: blackhawk-ski-club

### CampMinder (Example)
- **Config**: `mcp_server/providers/campminder/config.ts` (commented out)
- **Tools**: `cm.find_programs`, `cm.discover_required_fields`
- **URL Pattern**: Path (`campminder.com/orgref`)
- **Status**: Template ready, not yet active

## Troubleshooting

### Provider Not Found
- Ensure provider config imports in `mcp_server/index.ts`
- Check `registerProvider()` is called in provider config
- Verify provider ID matches in organization registration

### Organization Not Scraped
- Check `active: true` in organization config
- Verify `credentialId` is set (if required)
- Ensure provider is registered before organizations load

### Wrong Tool Invoked
- Verify `tools.findPrograms` and `tools.discoverFields` match actual tool names
- Check tool registration in provider implementation file

## Future Enhancements

- [ ] Provider-specific prerequisites systems
- [ ] Provider-specific question schemas
- [ ] Provider-specific payment flows
- [ ] Provider health monitoring
- [ ] Automatic provider failover
