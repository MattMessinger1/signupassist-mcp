/**
 * Sync Bookeo Events to Database
 * 
 * Fetches products and availability from Bookeo API and syncs to cached_provider_feed.
 * Uses eventId as the unique key for upserting.
 * 
 * Environment Variables:
 * - BOOKEO_API_KEY: Bookeo API key
 * - BOOKEO_SECRET_KEY: Bookeo secret key
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BOOKEO_API_BASE = 'https://api.bookeo.com/v2';

interface BookeoProduct {
  productId: string;
  name: string;
  description?: string;
  defaultRates?: Array<{
    peopleCategoryId: string;
    price: {
      amount: string; // Bookeo returns amount as string (e.g., "85")
      currency: string;
    };
  }>;
  duration?: number;
  maxParticipants?: number;
  category?: {
    name: string;
  };
  active: boolean;
  creationTime?: string;
  customFields?: Array<{ name: string; value: string }>;
}

interface BookeoSlot {
  eventId: string;
  startTime: string;
  endTime: string;
  numSeats: number;
  numSeatsAvailable: number;
}

/**
 * Create Bookeo API headers with authentication
 */
function createBookeoHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('BOOKEO_API_KEY');
  const secretKey = Deno.env.get('BOOKEO_SECRET_KEY');
  
  if (!apiKey || !secretKey) {
    throw new Error('BOOKEO_API_KEY and BOOKEO_SECRET_KEY must be set');
  }
  
  return {
    'X-Bookeo-apiKey': apiKey,
    'X-Bookeo-secretKey': secretKey,
    'Content-Type': 'application/json'
  };
}

/**
 * Fetch all products from Bookeo
 */
async function fetchBookeoProducts(): Promise<BookeoProduct[]> {
  console.log('[sync-bookeo] Fetching products from Bookeo API...');
  
  const response = await fetch(`${BOOKEO_API_BASE}/settings/products`, {
    headers: createBookeoHeaders()
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bookeo API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  const products = data.data || [];
  
  console.log(`[sync-bookeo] Fetched ${products.length} products`);
  return products;
}

/**
 * Fetch availability slots for a specific product
 */
async function fetchProductSlots(productId: string, startDate: string, endDate: string): Promise<BookeoSlot[]> {
  console.log(`[sync-bookeo] Fetching slots for product ${productId}...`);
  
  const params = new URLSearchParams({
    productId,
    startTime: startDate,
    endTime: endDate
  });
  
  const response = await fetch(`${BOOKEO_API_BASE}/availability/slots?${params}`, {
    headers: createBookeoHeaders()
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[sync-bookeo] Error fetching slots for ${productId}:`, errorText);
    return [];
  }
  
  const data = await response.json();
  const slots = data.data || [];
  
  console.log(`[sync-bookeo] Found ${slots.length} slots for product ${productId}`);
  return slots;
}

/**
 * Determine availability status from slots
 */
function determineStatus(slots: BookeoSlot[]): string {
  if (!slots || slots.length === 0) return 'Closed';
  
  const availableSlots = slots.filter(s => s.numSeatsAvailable > 0);
  if (availableSlots.length === 0) return 'Full';
  
  return 'Open';
}

/**
 * Map product category to our theme
 */
function mapCategory(product: BookeoProduct): string {
  const categoryName = product.category?.name?.toLowerCase() || '';
  const productName = product.name.toLowerCase();
  
  if (categoryName.includes('lesson') || productName.includes('lesson')) return 'lessons';
  if (categoryName.includes('camp') || productName.includes('camp')) return 'camps';
  if (categoryName.includes('event') || productName.includes('event')) return 'events';
  if (categoryName.includes('tour') || productName.includes('tour')) return 'tours';
  
  return 'all';
}

/**
 * Detect organization from Bookeo product custom fields
 * Smart namespacing based on product metadata
 */
function detectOrgRef(product: any): string {
  const orgField = product.customFields?.find((f: any) => 
    f.name.toLowerCase() === 'organization'
  );
  
  if (orgField?.value) {
    console.log(`[sync-bookeo] Product ${product.productId} → ${orgField.value}`);
    return orgField.value;
  }
  
  // Default to aim-design for existing products
  console.log(`[sync-bookeo] Product ${product.productId} → aim-design (default)`);
  return 'aim-design';
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[sync-bookeo] Starting Bookeo sync with smart namespacing...');
    
    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch all products
    const products = await fetchBookeoProducts();
    
    if (products.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No products found in Bookeo',
        synced: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Date range for availability lookup (next 30 days - Bookeo API max is 31 days)
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    let syncedCount = 0;
    const errors: any[] = [];
    const orgCounts: Record<string, number> = {};
    
    // Process each product
    for (const product of products) {
      try {
        // Detect org from product metadata
        const orgRef = detectOrgRef(product);
        
        // Fetch availability slots for this product
        const slots = await fetchProductSlots(product.productId, startDate, endDate);
        
        // Build program data
        const programData = {
          program_ref: product.productId,
          title: product.name,
          description: product.description || '',
          price: product.defaultRates?.[0]?.price?.amount 
            ? `$${parseFloat(product.defaultRates[0].price.amount).toFixed(2)}` 
            : 'Price varies',
          status: product.active ? determineStatus(slots) : 'Closed',
          duration: product.duration || null,
          max_participants: product.maxParticipants || null,
          category: product.category?.name || 'General',
          active: product.active,
          available_slots: slots.length,
          next_available: slots.find(s => s.numSeatsAvailable > 0)?.startTime || null
        };
        
        // Build signup form schema (basic Bookeo fields)
        const signupForm = {
          fields: [
            { id: 'firstName', label: 'First Name', type: 'text', required: true },
            { id: 'lastName', label: 'Last Name', type: 'text', required: true },
            { id: 'email', label: 'Email', type: 'email', required: true },
            { id: 'phone', label: 'Phone', type: 'tel', required: false },
            { id: 'numParticipants', label: 'Number of Participants', type: 'number', required: true, min: 1, max: product.maxParticipants || 10 }
          ]
        };
        
        // Upsert to cached_provider_feed with dynamic org_ref
        const { error } = await supabase.rpc('upsert_cached_provider_feed', {
          p_org_ref: orgRef,
          p_program_ref: product.productId,
          p_category: mapCategory(product),
          p_program: programData,
          p_prereq: { required: false }, // Bookeo doesn't have prerequisites
          p_signup_form: signupForm
        });
        
        if (error) {
          console.error(`[sync-bookeo] Error syncing product ${product.productId}:`, error);
          errors.push({ productId: product.productId, error: error.message });
        } else {
          syncedCount++;
          orgCounts[orgRef] = (orgCounts[orgRef] || 0) + 1;
          console.log(`[sync-bookeo] ✅ Synced ${product.productId} to ${orgRef}: ${product.name}`);
        }
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[sync-bookeo] Error processing product ${product.productId}:`, errorMsg);
        errors.push(`${product.productId}: ${errorMsg}`);
      }
    }
    
    console.log(`[sync-bookeo] Sync complete: ${syncedCount}/${products.length} products synced`);
    console.log('[sync-bookeo] Distribution by organization:', orgCounts);
    
    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${syncedCount}/${products.length} Bookeo products across organizations`,
      synced: syncedCount,
      total: products.length,
      organizations: orgCounts,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
    
  } catch (err) {
    console.error('[sync-bookeo] Fatal error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
