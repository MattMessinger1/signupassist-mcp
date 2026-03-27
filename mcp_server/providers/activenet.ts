/**
 * Active Network Provider - MCP Tools for ACTIVE Network activity search
 *
 * Uses two APIs:
 * 1. Activity Search API v2 (public, read-only) - find activities by location/keyword
 * 2. ActiveNet System API (authenticated) - program details & registration (future)
 *
 * Environment Variables:
 * - ACTIVE_SEARCH_API_V2_KEY: API key for Activity Search API v2
 * - ACTIVENET_API_KEY_US: API key for ActiveNet System API (US)
 * - ACTIVENET_API_KEY_CA: API key for ActiveNet System API (Canada)
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';
import { getPlaceholderImage } from '../lib/placeholderImages.js';
import { getProvider } from './registry.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Active Network Search API v2
const ACTIVE_SEARCH_API_KEY = String(process.env.ACTIVE_SEARCH_API_V2_KEY || '').trim();
const ACTIVE_SEARCH_BASE = 'http://api.amp.active.com/v2/search';

if (!ACTIVE_SEARCH_API_KEY) {
  console.warn('[ActiveNet] Missing ACTIVE_SEARCH_API_V2_KEY — search_activities will fail');
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Build Active Network Search API v2 URL
 */
function buildSearchUrl(params: Record<string, string | number | boolean>): string {
  const url = new URL(ACTIVE_SEARCH_BASE);
  url.searchParams.set('api_key', ACTIVE_SEARCH_API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Strip HTML tags from description text
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Response Normalization
// ============================================================================

interface NormalizedActivity {
  program_ref: string;        // assetGuid
  title: string;              // assetName
  description: string;        // cleaned description
  image_url: string | null;   // from assetImages or placeholder
  category: string;           // from assetTopics
  location_name: string;      // place name
  location_city: string;
  location_state: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null;
  end_date: string | null;
  registration_url: string | null;  // registrationUrlAdr
  sales_status: string | null;      // salesStatus
  organization: string | null;      // organizationName
  source_provider: 'activenet';
  price: string | null;
  metadata: Record<string, any>;
}

/**
 * Normalize a single Active Network search result to our standard format
 */
function normalizeActivity(result: any): NormalizedActivity {
  const place = result.place || {};
  const recurrences = result.activityRecurrences || [];
  const firstRecurrence = recurrences[0] || {};
  const images = result.assetImages || [];
  const topics = result.assetTopics || [];

  // Extract image URL
  let imageUrl: string | null = null;
  if (images.length > 0) {
    imageUrl = images[0].imageUrlAdr || images[0].imageThumbnailUrlAdr || null;
  }
  if (!imageUrl) {
    imageUrl = getPlaceholderImage(result.assetName || '');
  }

  // Extract location
  const city = place.cityName || place.city || '';
  const state = place.stateProvinceCode || place.state || '';
  const address = [
    place.addressLine1Adr || '',
    place.addressLine2Adr || ''
  ].filter(Boolean).join(', ');

  // Extract dates from recurrences
  const startDate = firstRecurrence.startDate || firstRecurrence.startTime || null;
  const endDate = firstRecurrence.endDate || firstRecurrence.endTime || null;

  // Extract category from topics
  const category = topics.length > 0
    ? topics.map((t: any) => t.topicName || t).filter(Boolean).join(', ')
    : 'General';

  // Extract description
  const descriptions = result.assetDescriptions || [];
  const descText = descriptions.length > 0
    ? stripHtml(descriptions[0].description || descriptions[0].descriptionText || '')
    : '';

  return {
    program_ref: result.assetGuid || result.assetId || '',
    title: result.assetName || 'Untitled Activity',
    description: descText.slice(0, 500),
    image_url: imageUrl,
    category,
    location_name: place.placeName || '',
    location_city: city,
    location_state: state,
    location_address: address,
    latitude: place.latitude || place.geoPoint?.lat || null,
    longitude: place.longitude || place.geoPoint?.lon || null,
    start_date: startDate,
    end_date: endDate,
    registration_url: result.registrationUrlAdr || result.urlAdr || null,
    sales_status: result.salesStatus || null,
    organization: result.organizationName || result.organization?.organizationName || null,
    source_provider: 'activenet',
    price: result.activityStartPrice || null,
    metadata: {
      assetTypeId: result.assetTypeId,
      assetStatusId: result.assetStatusId,
      contactName: result.contactName,
      contactEmailAdr: result.contactEmailAdr,
      contactPhone: result.contactPhone,
      topicIds: topics.map((t: any) => t.topicId || t),
      recurrences: recurrences.slice(0, 5), // Keep first 5 schedules
    }
  };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Search for activities via Active Network Search API v2
 */
async function searchActivities(args: {
  location: string;
  query?: string;
  category?: string;
  radius?: number;
  kids_only?: boolean;
  sort?: string;
  per_page?: number;
  current_page?: number;
  start_date?: string;
}): Promise<ProviderResponse<any>> {
  const {
    location,
    query,
    category,
    radius = 50,
    kids_only = true,
    sort = 'date_asc',
    per_page = 25,
    current_page = 1,
    start_date
  } = args;

  console.log(`[ActiveNet] Searching activities near: ${location}, query: ${query || '(all)'}, kids: ${kids_only}`);

  try {
    // Build search params
    const params: Record<string, string | number | boolean> = {
      near: location,
      radius,
      sort,
      per_page,
      current_page
    };

    if (query) params.query = query;
    if (category) params.category = category;
    if (kids_only) params.kids = 'true';
    if (start_date) params.start_date = start_date;

    const url = buildSearchUrl(params);
    console.log(`[ActiveNet] API URL: ${url.replace(ACTIVE_SEARCH_API_KEY, '***')}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[ActiveNet] API error: ${response.status} ${errorText.slice(0, 200)}`);

      // Fall back to cached data
      return await searchFromCache(location, query, category);
    }

    const data = await response.json();
    const results = data.results || [];

    console.log(`[ActiveNet] Got ${results.length} results (total: ${data.total_results || 0})`);

    // Normalize all results
    const activities = results.map(normalizeActivity);

    // Group by theme
    const provider = getProvider('activenet');
    const programsByTheme: Record<string, NormalizedActivity[]> = {};
    for (const activity of activities) {
      const theme = provider?.determineTheme(activity.title) || 'All Programs';
      if (!programsByTheme[theme]) programsByTheme[theme] = [];
      programsByTheme[theme].push(activity);
    }

    // Build UI cards
    const cards = activities.map(buildActivityCard);

    return {
      success: true,
      data: {
        programs_by_theme: programsByTheme,
        total_programs: activities.length,
        total_results: data.total_results || activities.length,
        org_ref: 'activenet-national',
        provider: 'activenet',
        search_params: { location, query, category, radius, kids_only }
      },
      ui: {
        cards,
        message: activities.length > 0
          ? `Found ${activities.length} ${kids_only ? 'kids ' : ''}activities near ${location}`
          : `No activities found near ${location}. Try expanding your search radius or changing keywords.`
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[ActiveNet] searchActivities error:', error);

    // Try cache fallback
    try {
      return await searchFromCache(location, query, category);
    } catch {
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to search for activities right now. Please try again in a moment.',
        recovery: 'Try searching again, or check your internet connection.',
        severity: 'medium'
      };
      return { success: false, error: friendlyError };
    }
  }
}

/**
 * Fallback: search from cached_provider_feed when API is unavailable
 */
async function searchFromCache(
  location: string,
  query?: string,
  category?: string
): Promise<ProviderResponse<any>> {
  console.log('[ActiveNet] Falling back to cached data');

  let dbQuery = supabase
    .from('cached_provider_feed')
    .select('program_ref, program, org_ref, category')
    .eq('org_ref', 'activenet-national')
    .limit(25);

  if (category && category !== 'all') {
    dbQuery = dbQuery.eq('category', category);
  }

  const { data: programs, error } = await dbQuery;

  if (error) {
    console.error('[ActiveNet] Cache query error:', error);
    return {
      success: false,
      error: {
        display: 'Unable to search activities. Please try again later.',
        recovery: 'Try again in a few moments.',
        severity: 'medium'
      }
    };
  }

  const activities = (programs || []).map((p: any) => ({
    ...p.program,
    source_provider: 'activenet'
  }));

  const provider = getProvider('activenet');
  const programsByTheme: Record<string, any[]> = {};
  for (const activity of activities) {
    const theme = provider?.determineTheme(activity.title || '') || 'All Programs';
    if (!programsByTheme[theme]) programsByTheme[theme] = [];
    programsByTheme[theme].push(activity);
  }

  return {
    success: true,
    login_status: 'cached',
    data: {
      programs_by_theme: programsByTheme,
      total_programs: activities.length,
      org_ref: 'activenet-national',
      provider: 'activenet',
      source: 'cache'
    },
    ui: {
      cards: activities.map(buildActivityCard),
      message: activities.length > 0
        ? `Showing ${activities.length} cached activities (live search unavailable)`
        : 'No cached activities available.'
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Get detailed info for a specific activity
 */
async function getActivityDetails(args: {
  asset_guid: string;
}): Promise<ProviderResponse<any>> {
  const { asset_guid } = args;
  console.log(`[ActiveNet] Getting details for asset: ${asset_guid}`);

  try {
    // Search by asset_guid for full details
    const url = buildSearchUrl({ asset_guid });
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[ActiveNet] Details API error: ${response.status} ${errorText.slice(0, 200)}`);
      return {
        success: false,
        error: {
          display: 'Unable to fetch activity details. Please try again.',
          recovery: 'Try again or search for the activity by name.',
          severity: 'low'
        }
      };
    }

    const data = await response.json();
    const results = data.results || [];

    if (results.length === 0) {
      return {
        success: false,
        error: {
          display: 'Activity not found. It may have been removed or the listing has expired.',
          recovery: 'Try searching for similar activities.',
          severity: 'low'
        }
      };
    }

    const activity = normalizeActivity(results[0]);

    return {
      success: true,
      data: {
        program_ref: activity.program_ref,
        activity,
        registration_url: activity.registration_url,
        sales_status: activity.sales_status,
        program_questions: {
          // Active Network registration happens on external site via registrationUrlAdr
          // No API-based form discovery needed for Search API v2
          delegate_fields: [
            { name: 'registration_url', type: 'url', label: 'Registration Link', value: activity.registration_url }
          ],
          participant_fields: [],
          registration_method: 'external_url',
          registration_url: activity.registration_url
        },
        metadata: {
          product_name: activity.title,
          organization: activity.organization,
          location: `${activity.location_city}, ${activity.location_state}`,
          discovered_at: new Date().toISOString(),
          source: 'active_network_api_v2'
        }
      },
      ui: {
        cards: [buildActivityCard(activity)],
        message: activity.registration_url
          ? `**${activity.title}** — Registration is available at the provider's website.`
          : `**${activity.title}** — Contact the provider for registration details.`
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[ActiveNet] getActivityDetails error:', error);
    return {
      success: false,
      error: {
        display: 'Unable to fetch activity details right now.',
        recovery: 'Please try again in a moment.',
        severity: 'medium'
      }
    };
  }
}

// ============================================================================
// UI Card Builder
// ============================================================================

function buildActivityCard(activity: any): any {
  const locationParts = [
    activity.location_city,
    activity.location_state
  ].filter(Boolean);
  const locationText = locationParts.length > 0 ? locationParts.join(', ') : 'Location TBD';

  // Format dates
  let dateText = 'Date TBD';
  if (activity.start_date) {
    try {
      const start = new Date(activity.start_date);
      dateText = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (activity.end_date) {
        const end = new Date(activity.end_date);
        if (end.getTime() !== start.getTime()) {
          dateText += ` – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
      }
    } catch { /* keep "Date TBD" */ }
  }

  // Status badge
  const statusMap: Record<string, string> = {
    'registration-open': 'Open',
    'registration-closed': 'Closed',
    'sold-out': 'Sold Out',
    'coming-soon': 'Coming Soon'
  };
  const statusText = activity.sales_status
    ? (statusMap[activity.sales_status] || activity.sales_status)
    : '';

  const card: any = {
    type: 'program_card',
    title: activity.title || 'Activity',
    subtitle: activity.organization || '',
    image_url: activity.image_url,
    fields: [
      { label: 'Location', value: locationText },
      { label: 'Dates', value: dateText }
    ],
    source_provider: 'activenet',
    program_ref: activity.program_ref
  };

  if (activity.price) {
    card.fields.push({ label: 'Price', value: `$${activity.price}` });
  }

  if (statusText) {
    card.fields.push({ label: 'Status', value: statusText });
  }

  if (activity.registration_url) {
    card.actions = [
      { label: 'Register', url: activity.registration_url, type: 'link' }
    ];
  }

  return card;
}

// ============================================================================
// Tool Interface & Export
// ============================================================================

export interface ActiveNetTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: {
    'openai/safety'?: 'read-only' | 'write' | 'sensitive';
  };
}

export const activeNetTools: ActiveNetTool[] = [
  {
    name: 'activenet.search_activities',
    description: `Read-only activity search tool.
Searches the ACTIVE Network national database for kids activities, camps, classes, sports programs, and more.
Returns activities near a specified location with registration links.
Does NOT create registrations or bookings.
Does NOT charge payments.
Safe to call for browsing and exploration.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: {
      'openai/safety': 'read-only'
    },
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Location to search near (e.g., "San Diego, CA" or "Chicago, IL")'
        },
        query: {
          type: 'string',
          description: 'Keyword search (e.g., "soccer", "coding camp", "swim lessons")'
        },
        category: {
          type: 'string',
          description: 'Activity category filter',
          enum: ['event', 'class', 'camp', 'league', 'clinic', 'workshop', 'tournament']
        },
        radius: {
          type: 'number',
          description: 'Search radius in miles (default: 50)'
        },
        kids_only: {
          type: 'boolean',
          description: 'Filter to kids activities only (default: true)'
        },
        sort: {
          type: 'string',
          description: 'Sort order',
          enum: ['date_asc', 'date_desc', 'distance']
        },
        per_page: {
          type: 'number',
          description: 'Results per page (default: 25, max: 100)'
        },
        current_page: {
          type: 'number',
          description: 'Page number for pagination (default: 1)'
        },
        start_date: {
          type: 'string',
          description: 'Filter activities starting after this date (YYYY-MM-DD)'
        }
      },
      required: ['location']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'activenet.search_activities' },
        args,
        () => searchActivities(args)
      );
    }
  },
  {
    name: 'activenet.get_activity_details',
    description: `Read-only activity details tool.
Returns detailed information about a specific ACTIVE Network activity, including registration URL and availability status.
Does NOT create registrations or bookings.
Does NOT charge payments.
Safe to call for exploring activity details.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: {
      'openai/safety': 'read-only'
    },
    inputSchema: {
      type: 'object',
      properties: {
        asset_guid: {
          type: 'string',
          description: 'ACTIVE Network asset GUID (unique activity identifier)'
        }
      },
      required: ['asset_guid']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'activenet.get_activity_details' },
        args,
        () => getActivityDetails(args)
      );
    }
  }
];
