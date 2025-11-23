/**
 * Bookeo Provider - MCP Tools for Bookeo automation
 * API-based provider using Bookeo REST API v2
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse } from '../types.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Bookeo API credentials
const BOOKEO_API_KEY = process.env.BOOKEO_API_KEY!;
const BOOKEO_SECRET_KEY = process.env.BOOKEO_SECRET_KEY!;
const BOOKEO_API_BASE = 'https://api.bookeo.com/v2';

export interface BookeoTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
}

/**
 * Create Bookeo API authorization header
 */
function bookeoHeaders() {
  const auth = Buffer.from(`${BOOKEO_API_KEY}:${BOOKEO_SECRET_KEY}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Tool: bookeo.find_programs
 * Fetches available programs/products from Bookeo API
 */
async function findPrograms(args: {
  org_ref: string;
  category?: string;
  user_jwt?: string;
  mandate_jws?: string;
  user_id?: string;
}): Promise<ProviderResponse<any>> {
  const { org_ref, category = 'all', user_id } = args;
  
  console.log(`[Bookeo] Finding programs for org: ${org_ref}, category: ${category}`);
  
  try {
    // Fetch products from Bookeo API
    const response = await fetch(`${BOOKEO_API_BASE}/settings/products`, {
      headers: bookeoHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Bookeo API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const products = data.data || [];
    
    console.log(`[Bookeo] Retrieved ${products.length} products from API`);
    
    // Transform Bookeo products into our program format
    const programsByTheme: Record<string, any[]> = {};
    
    for (const product of products) {
      const program = {
        program_ref: product.productId,
        title: product.name,
        price: product.prices?.[0]?.price?.amount 
          ? `$${(product.prices[0].price.amount / 100).toFixed(2)}` 
          : 'Price varies',
        status: product.active ? 'Open' : 'Closed',
        description: product.description || '',
        duration: product.duration || '',
        category: product.category?.name || 'General',
        max_participants: product.maxParticipants || null,
        signup_start_time: product.creationTime || new Date().toISOString()
      };
      
      // Determine theme based on product category or name
      const theme = determineTheme(product.name, product.category?.name);
      
      if (!programsByTheme[theme]) {
        programsByTheme[theme] = [];
      }
      
      programsByTheme[theme].push(program);
    }
    
    // Cache the results in cached_programs table
    const cacheResult = await supabase.rpc('upsert_cached_programs_enhanced', {
      p_org_ref: org_ref,
      p_provider: 'bookeo',
      p_category: category,
      p_programs_by_theme: programsByTheme,
      p_metadata: {
        fetched_at: new Date().toISOString(),
        product_count: products.length,
        api_version: 'v2'
      },
      p_ttl_hours: 24
    });
    
    if (cacheResult.error) {
      console.error('[Bookeo] Cache error:', cacheResult.error);
    }
    
    return {
      success: true,
      data: {
        programs_by_theme: programsByTheme,
        total_programs: products.length,
        org_ref,
        provider: 'bookeo'
      },
      session_token: undefined,
      ui: {
        cards: [{
          type: 'confirmation',
          title: 'Programs Found',
          message: `Found ${products.length} available programs`,
          variant: 'success'
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error finding programs:', error);
    return {
      success: false,
      error: {
        message: `Failed to fetch programs: ${error.message}`,
        code: 'BOOKEO_API_ERROR',
        recovery_hint: 'Check API credentials and try again'
      }
    };
  }
}

/**
 * Tool: bookeo.discover_required_fields
 * Discovers required fields for a specific Bookeo product
 */
async function discoverRequiredFields(args: {
  program_ref: string;
  org_ref: string;
  user_jwt?: string;
  mandate_jws?: string;
}): Promise<ProviderResponse<any>> {
  const { program_ref, org_ref } = args;
  
  console.log(`[Bookeo] Discovering fields for program: ${program_ref}`);
  
  try {
    // Fetch product details including custom fields
    const response = await fetch(`${BOOKEO_API_BASE}/settings/products/${program_ref}`, {
      headers: bookeoHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`Bookeo API error: ${response.status} ${response.statusText}`);
    }
    
    const product = await response.json();
    
    // Build field schema from Bookeo product configuration
    const fields: any[] = [];
    
    // Standard participant information fields
    fields.push(
      {
        id: 'firstName',
        label: 'First Name',
        type: 'text',
        required: true,
        category: 'participant'
      },
      {
        id: 'lastName',
        label: 'Last Name',
        type: 'text',
        required: true,
        category: 'participant'
      },
      {
        id: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        category: 'contact'
      }
    );
    
    // Add custom fields if defined
    if (product.customFields) {
      for (const field of product.customFields) {
        fields.push({
          id: field.id,
          label: field.name,
          type: mapBookeoFieldType(field.type),
          required: field.required || false,
          category: 'custom',
          options: field.choices?.map((c: any) => ({ value: c, label: c }))
        });
      }
    }
    
    // Add number of participants field
    fields.push({
      id: 'numParticipants',
      label: 'Number of Participants',
      type: 'number',
      required: true,
      category: 'booking',
      min: 1,
      max: product.maxParticipants || 10
    });
    
    return {
      success: true,
      data: {
        program_ref,
        program_questions: fields,
        metadata: {
          product_name: product.name,
          duration: product.duration,
          max_participants: product.maxParticipants,
          discovered_at: new Date().toISOString()
        }
      },
      session_token: undefined,
      ui: {
        cards: [{
          type: 'confirmation',
          title: 'Fields Discovered',
          message: `Found ${fields.length} required fields for ${product.name}`,
          variant: 'success'
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error discovering fields:', error);
    return {
      success: false,
      error: {
        message: `Failed to discover fields: ${error.message}`,
        code: 'BOOKEO_API_ERROR',
        recovery_hint: 'Check program reference and try again'
      }
    };
  }
}

/**
 * Map Bookeo field types to our standard types
 */
function mapBookeoFieldType(bookeoType: string): string {
  const mapping: Record<string, string> = {
    'text': 'text',
    'number': 'number',
    'dropdown': 'select',
    'checkbox': 'checkbox',
    'textarea': 'textarea',
    'date': 'date',
    'email': 'email',
    'phone': 'tel'
  };
  return mapping[bookeoType] || 'text';
}

/**
 * Determine theme/category for a Bookeo product
 */
function determineTheme(productName: string, categoryName?: string): string {
  const name = (productName + ' ' + (categoryName || '')).toLowerCase();
  
  if (name.includes('lesson') || name.includes('class')) return 'Lessons & Classes';
  if (name.includes('camp') || name.includes('clinic')) return 'Camps & Clinics';
  if (name.includes('event') || name.includes('workshop')) return 'Events & Workshops';
  if (name.includes('tour') || name.includes('experience')) return 'Tours & Experiences';
  
  return 'All Programs';
}

/**
 * Export Bookeo tools
 */
export const bookeoTools: BookeoTool[] = [
  {
    name: 'bookeo.find_programs',
    description: 'Find available programs/products from Bookeo booking system',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: {
          type: 'string',
          description: 'Organization reference (e.g., "my-organization")'
        },
        category: {
          type: 'string',
          description: 'Filter by category (optional)',
          enum: ['all', 'lessons', 'camps', 'events', 'tours']
        },
        user_jwt: {
          type: 'string',
          description: 'User JWT for authentication (optional)'
        },
        mandate_jws: {
          type: 'string',
          description: 'Mandate JWS for authorization (optional)'
        },
        user_id: {
          type: 'string',
          description: 'User ID for audit logging'
        }
      },
      required: ['org_ref']
    },
    handler: async (args: any) => {
      return auditToolCall('bookeo.find_programs', args, () => findPrograms(args));
    }
  },
  {
    name: 'bookeo.discover_required_fields',
    description: 'Discover required fields for booking a specific Bookeo product',
    inputSchema: {
      type: 'object',
      properties: {
        program_ref: {
          type: 'string',
          description: 'Bookeo product ID'
        },
        org_ref: {
          type: 'string',
          description: 'Organization reference'
        },
        user_jwt: {
          type: 'string',
          description: 'User JWT for authentication (optional)'
        },
        mandate_jws: {
          type: 'string',
          description: 'Mandate JWS for authorization (optional)'
        }
      },
      required: ['program_ref', 'org_ref']
    },
    handler: async (args: any) => {
      return auditToolCall('bookeo.discover_required_fields', args, () => discoverRequiredFields(args));
    }
  }
];
