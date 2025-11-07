# Task 4: Database Cache Infrastructure

## Overview
Created database cache infrastructure for instant program loading, reducing load times from 90-110s to near-instant (<1s) for cached data.

## Database Schema

### Table: `cached_programs`

```sql
CREATE TABLE public.cached_programs (
  id UUID PRIMARY KEY,
  org_ref TEXT NOT NULL,              -- Organization reference (e.g., "blackhawk-ski-club")
  category TEXT NOT NULL DEFAULT 'all', -- Program category ("lessons", "all", etc.)
  cache_key TEXT NOT NULL UNIQUE,      -- Unique key: "{org_ref}:{category}"
  programs_by_theme JSONB NOT NULL,    -- Grouped programs data structure
  metadata JSONB DEFAULT '{}',         -- Additional metadata (total_count, themes, etc.)
  cached_at TIMESTAMP NOT NULL,        -- When cache was created/updated
  expires_at TIMESTAMP NOT NULL,       -- When cache expires
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### Indexes

```sql
-- Fast lookup by org + category
CREATE INDEX idx_cached_programs_org_category 
  ON cached_programs(org_ref, category);

-- Unique lookup by cache key
CREATE INDEX idx_cached_programs_cache_key 
  ON cached_programs(cache_key);

-- Expiry cleanup
CREATE INDEX idx_cached_programs_expires_at 
  ON cached_programs(expires_at);
```

### RLS Policies

1. **Service role**: Full access (for cron jobs to write cache)
2. **Authenticated users**: Read-only access
3. **Anonymous users**: Read-only access (for public flows)

## RPC Functions

### 1. `find_programs_cached()`

Fast lookup function for retrieving cached program data.

**Signature:**
```sql
find_programs_cached(
  p_org_ref TEXT,
  p_category TEXT DEFAULT 'all',
  p_max_age_hours INTEGER DEFAULT 24
) RETURNS JSONB
```

**Parameters:**
- `p_org_ref`: Organization reference (e.g., "blackhawk-ski-club")
- `p_category`: Program category filter (default: "all")
- `p_max_age_hours`: Maximum cache age to accept (default: 24 hours)

**Returns:**
- `programs_by_theme` JSONB if cache hit
- `{}` (empty object) if cache miss

**Example Usage:**
```typescript
const { data } = await supabase.rpc('find_programs_cached', {
  p_org_ref: 'blackhawk-ski-club',
  p_category: 'lessons',
  p_max_age_hours: 24
});

if (data && Object.keys(data).length > 0) {
  console.log('Cache hit!', data);
} else {
  console.log('Cache miss, need to scrape');
}
```

### 2. `upsert_cached_programs()`

Upserts program cache with automatic expiry calculation (Service role only).

**Signature:**
```sql
upsert_cached_programs(
  p_org_ref TEXT,
  p_category TEXT,
  p_programs_by_theme JSONB,
  p_metadata JSONB DEFAULT '{}',
  p_ttl_hours INTEGER DEFAULT 24
) RETURNS UUID
```

**Parameters:**
- `p_org_ref`: Organization reference
- `p_category`: Program category
- `p_programs_by_theme`: Grouped programs data
- `p_metadata`: Optional metadata (total count, themes list, etc.)
- `p_ttl_hours`: Cache TTL in hours (default: 24)

**Returns:** Cache entry UUID

**Example Usage (from Edge Function):**
```typescript
const { data: cacheId } = await supabaseAdmin.rpc('upsert_cached_programs', {
  p_org_ref: 'blackhawk-ski-club',
  p_category: 'all',
  p_programs_by_theme: programsByTheme,
  p_metadata: {
    total_count: 47,
    themes: ['Lessons & Classes', 'Races & Teams'],
    scraped_at: new Date().toISOString()
  },
  p_ttl_hours: 24
});
```

### 3. `cleanup_expired_program_cache()`

Removes expired cache entries (called by cron job).

**Signature:**
```sql
cleanup_expired_program_cache() RETURNS INTEGER
```

**Returns:** Count of deleted entries

## Cache Key Format

**Pattern:** `{org_ref}:{category}`

**Examples:**
- `blackhawk-ski-club:all`
- `blackhawk-ski-club:lessons`
- `blackhawk-ski-club:teams`

## Metadata Structure

Recommended metadata fields:

```typescript
{
  total_count: number;      // Total program count
  themes: string[];         // List of theme names
  scraped_at: string;       // ISO timestamp of scrape
  filters_applied?: {       // Any filters used during scrape
    dayOfWeek?: string;
    timeOfDay?: string;
  };
}
```

## Cache Strategy

### TTL (Time-to-Live)
- **Default:** 24 hours
- **Configurable:** Set via `p_ttl_hours` parameter
- **Expiry:** Automatic cleanup via cron job

### Cache Invalidation
1. **Time-based:** Expires after TTL
2. **Manual:** Upsert with new data overwrites old cache
3. **Cleanup:** Cron job removes expired entries

### Cache Hit Criteria
1. Matching `org_ref` + `category`
2. Not expired (`expires_at > now()`)
3. Within max age (`cached_at > now() - p_max_age_hours`)
4. Most recent entry if multiple matches

## Integration Flow

### 1. Check Cache First (AIOrchestrator)

```typescript
// In handleAutoProgramDiscovery
const cacheKey = `programs:${ctx.provider.orgRef}:${ctx.category || 'all'}`;

// Try RPC first
const { data: cachedPrograms } = await supabase.rpc('find_programs_cached', {
  p_org_ref: ctx.provider.orgRef,
  p_category: ctx.category || 'all',
  p_max_age_hours: 24
});

if (cachedPrograms && Object.keys(cachedPrograms).length > 0) {
  console.log('✅ Cache hit! Instant load');
  return await this.presentProgramsAsCards(ctx, cachedPrograms);
}

// Cache miss - proceed with live scrape
console.log('Cache miss - scraping live data');
const res = await this.callTool("scp.find_programs", args, sessionId);
```

### 2. Populate Cache (Edge Function - Task 5)

```typescript
// After successful scrape
const { data: cacheId } = await supabaseAdmin.rpc('upsert_cached_programs', {
  p_org_ref: orgRef,
  p_category: category,
  p_programs_by_theme: programsByTheme,
  p_metadata: {
    total_count: Object.values(programsByTheme).flat().length,
    themes: Object.keys(programsByTheme),
    scraped_at: new Date().toISOString()
  }
});

console.log('Cache populated:', cacheId);
```

## Performance Impact

### Before Cache
- **Cold start**: 90-110 seconds (login + scrape + extract)
- **Every request**: Full Browserbase session + OpenAI extraction

### After Cache
- **Cache hit**: <1 second (database RPC call)
- **Cache miss**: 90-110 seconds (same as before, but result cached)
- **Subsequent requests**: Instant (from cache)

### Expected Cache Hit Rate
- **First hour**: 10-20% (cache being built)
- **After 24 hours**: 80-90% (cache populated for common orgs/categories)

## Next Steps (Task 5)

Create nightly scraper Edge Function to proactively populate cache:
1. Create `supabase/functions/refresh-program-cache/index.ts`
2. Scrape common org/category combinations
3. Store results via `upsert_cached_programs()`
4. Schedule as cron job (nightly at 2 AM)

## Testing

### Manual Cache Population

```sql
-- Insert test cache entry
SELECT upsert_cached_programs(
  'blackhawk-ski-club',
  'all',
  '{"Lessons & Classes": [{"title": "Test Program", "price": "$100"}]}'::jsonb,
  '{"total_count": 1}'::jsonb,
  24
);
```

### Query Cache

```sql
-- Check cache contents
SELECT 
  org_ref,
  category,
  cached_at,
  expires_at,
  jsonb_array_length(programs_by_theme->'Lessons & Classes') as programs_count
FROM cached_programs
WHERE org_ref = 'blackhawk-ski-club';
```

### Cleanup Test

```sql
-- Run cleanup
SELECT cleanup_expired_program_cache();
```

## Monitoring

### Key Metrics
1. Cache hit rate: `(hits / total_requests) * 100`
2. Cache size: Count of entries
3. Average cache age: `now() - cached_at`
4. Expired entries: Count where `expires_at < now()`

### Logs to Watch
```
[Cache] Hit! Returning 47 programs from cache
[Cache] Miss, proceeding with live scrape
[Cache] Populated: blackhawk-ski-club:all (47 programs)
```
