/**
 * Sync Active Network Activities to Database
 *
 * Searches the ACTIVE Network Activity Search API v2 for kids activities
 * across configured service areas and caches results to cached_provider_feed.
 *
 * Environment Variables:
 * - ACTIVE_SEARCH_API_V2_KEY: Active Network Search API v2 key
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTIVE_SEARCH_BASE = 'http://api.amp.active.com/v2/search';

// Service areas to sync — major metro areas for national coverage
const SYNC_LOCATIONS = [
  'Madison, WI',
  'Milwaukee, WI',
  'Chicago, IL',
  'Minneapolis, MN',
  'New York, NY',
  'Los Angeles, CA',
  'San Francisco, CA',
  'San Diego, CA',
  'Denver, CO',
  'Seattle, WA',
  'Portland, OR',
  'Austin, TX',
  'Dallas, TX',
  'Houston, TX',
  'Atlanta, GA',
  'Miami, FL',
  'Boston, MA',
  'Philadelphia, PA',
  'Phoenix, AZ',
  'Nashville, TN',
];

/**
 * Build Active Network Search API URL
 */
function buildSearchUrl(params: Record<string, string>): string {
  const apiKey = Deno.env.get('ACTIVE_SEARCH_API_V2_KEY');
  if (!apiKey) {
    throw new Error('ACTIVE_SEARCH_API_V2_KEY must be set');
  }

  const url = new URL(ACTIVE_SEARCH_BASE);
  url.searchParams.set('api_key', apiKey);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Fetch activities from Active Network for a given location
 */
async function fetchActivities(location: string, page: number = 1): Promise<{ results: any[]; totalResults: number }> {
  console.log(`[sync-activenet] Fetching activities near ${location} (page ${page})...`);

  const url = buildSearchUrl({
    near: location,
    kids: 'true',
    radius: '50',
    per_page: '50',
    current_page: String(page),
    sort: 'date_asc'
  });

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[sync-activenet] API error for ${location}: ${response.status} ${errorText.slice(0, 200)}`);
    return { results: [], totalResults: 0 };
  }

  const data = await response.json();
  const results = data.results || [];
  const totalResults = data.total_results || 0;

  console.log(`[sync-activenet] Got ${results.length} results for ${location} (total: ${totalResults})`);
  return { results, totalResults };
}

/**
 * Strip HTML from text
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map category from activity topics
 */
function mapCategory(result: any): string {
  const topics = result.assetTopics || [];
  const topicNames = topics.map((t: any) => (t.topicName || '').toLowerCase()).join(' ');
  const name = (result.assetName || '').toLowerCase();
  const combined = topicNames + ' ' + name;

  if (combined.includes('camp') || combined.includes('clinic')) return 'camps';
  if (combined.includes('lesson') || combined.includes('class')) return 'lessons';
  if (combined.includes('sport') || combined.includes('soccer') || combined.includes('baseball')) return 'sports';
  if (combined.includes('art') || combined.includes('craft') || combined.includes('theater')) return 'arts';
  if (combined.includes('dance') || combined.includes('cheer') || combined.includes('gymnastics')) return 'dance';
  if (combined.includes('swim') || combined.includes('aqua')) return 'swim';

  return 'all';
}

/**
 * Normalize an Active Network result to cached_provider_feed format
 */
function normalizeResult(result: any): {
  program_ref: string;
  org_ref: string;
  category: string;
  program: Record<string, any>;
} {
  const place = result.place || {};
  const recurrences = result.activityRecurrences || [];
  const firstRecurrence = recurrences[0] || {};
  const descriptions = result.assetDescriptions || [];
  const images = result.assetImages || [];

  // Extract image
  let imageUrl: string | null = null;
  if (images.length > 0) {
    imageUrl = images[0].imageUrlAdr || images[0].imageThumbnailUrlAdr || null;
  }

  // Extract description
  const descText = descriptions.length > 0
    ? stripHtml(descriptions[0].description || descriptions[0].descriptionText || '')
    : '';

  // Build location string
  const city = place.cityName || place.city || '';
  const state = place.stateProvinceCode || place.state || '';
  const address = [place.addressLine1Adr || '', place.addressLine2Adr || ''].filter(Boolean).join(', ');

  // Extract price
  let price: string | null = null;
  if (result.activityStartPrice) {
    price = `$${result.activityStartPrice}`;
  }

  // Sales status mapping
  const statusMap: Record<string, string> = {
    'registration-open': 'Open',
    'registration-closed': 'Closed',
    'sold-out': 'Full',
    'coming-soon': 'Coming Soon'
  };
  const status = result.salesStatus
    ? (statusMap[result.salesStatus] || result.salesStatus)
    : 'Open';

  return {
    program_ref: result.assetGuid || result.assetId || '',
    org_ref: 'activenet-national',
    category: mapCategory(result),
    program: {
      program_ref: result.assetGuid || result.assetId || '',
      title: result.assetName || 'Untitled Activity',
      description: descText.slice(0, 1000),
      image_url: imageUrl,
      price,
      status,
      source_provider: 'activenet',
      signup_start_time: firstRecurrence.startDate || firstRecurrence.startTime || null,
      start_date: firstRecurrence.startDate || firstRecurrence.startTime || null,
      end_date: firstRecurrence.endDate || firstRecurrence.endTime || null,
      location_name: place.placeName || '',
      location_city: city,
      location_state: state,
      location_address: address,
      latitude: place.latitude || place.geoPoint?.lat || null,
      longitude: place.longitude || place.geoPoint?.lon || null,
      registration_url: result.registrationUrlAdr || result.urlAdr || null,
      sales_status: result.salesStatus || null,
      organization: result.organizationName || result.organization?.organizationName || null,
      metadata: {
        assetTypeId: result.assetTypeId,
        topics: (result.assetTopics || []).map((t: any) => t.topicName || t),
        contactName: result.contactName,
        contactEmail: result.contactEmailAdr,
        contactPhone: result.contactPhone,
      }
    }
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[sync-activenet] Starting Active Network sync...');

    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let totalSynced = 0;
    const errors: any[] = [];
    const locationCounts: Record<string, number> = {};

    // Process each location
    for (const location of SYNC_LOCATIONS) {
      try {
        // Fetch first page (up to 50 results per location)
        const { results } = await fetchActivities(location);

        if (results.length === 0) {
          locationCounts[location] = 0;
          continue;
        }

        // Normalize all results
        const records = results
          .map(normalizeResult)
          .filter(r => r.program_ref); // Skip any without a valid ID

        // Deduplicate by program_ref (same activity may appear in multiple location searches)
        const uniqueRecords = new Map<string, typeof records[0]>();
        for (const record of records) {
          if (!uniqueRecords.has(record.program_ref)) {
            uniqueRecords.set(record.program_ref, record);
          }
        }

        const toUpsert = Array.from(uniqueRecords.values());

        if (toUpsert.length > 0) {
          const { error } = await supabase
            .from('cached_provider_feed')
            .upsert(toUpsert, {
              onConflict: 'org_ref,program_ref',
              ignoreDuplicates: false
            });

          if (error) {
            console.error(`[sync-activenet] Upsert error for ${location}:`, error);
            errors.push({ location, error: error.message });
          } else {
            totalSynced += toUpsert.length;
            locationCounts[location] = toUpsert.length;
            console.log(`[sync-activenet] Synced ${toUpsert.length} activities for ${location}`);
          }
        }

        // Rate limiting — be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (locationError) {
        console.error(`[sync-activenet] Error processing ${location}:`, locationError);
        errors.push({ location, error: String(locationError) });
      }
    }

    const summary = {
      success: true,
      message: `Active Network sync complete`,
      total_synced: totalSynced,
      locations_processed: SYNC_LOCATIONS.length,
      location_counts: locationCounts,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    };

    console.log('[sync-activenet] Sync complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[sync-activenet] Fatal error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
