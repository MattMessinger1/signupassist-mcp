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
 * Fetches available programs/products from Bookeo API and returns ChatGPT carousel
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
    // Fetch from cached_provider_feed for active, open, future programs
    const nowIso = new Date().toISOString();
    const { data: programs, error } = await supabase
      .from('cached_provider_feed')
      .select('program_ref, program, org_ref, category')
      .eq('org_ref', org_ref)
      .filter('program->status', 'in', '("Open","Register")')
      .gte('program->signup_start_time', nowIso)
      .order('program->signup_start_time', { ascending: true })
      .limit(8);
    
    if (error) {
      console.error('[Bookeo] Database error:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    
    if (!programs || programs.length === 0) {
      console.log('[Bookeo] No programs found in cache');
      return {
        success: true,
        data: { programs_by_theme: {}, total_programs: 0, org_ref, provider: 'bookeo' },
        ui: {
          cards: [{
            type: 'status',
            componentType: 'status',
            title: 'No Programs Available',
            message: 'There are no upcoming programs available at this time.'
          }]
        }
      };
    }
    
    console.log(`[Bookeo] Found ${programs.length} programs`);
    
    // Build carousel items
    const carouselItems = programs.map(row => {
      const prog = row.program as any;
      return {
        title: prog.title || 'Untitled Program',
        subtitle: `${prog.signup_start_time ? new Date(prog.signup_start_time).toLocaleDateString() : 'Date TBD'} – ${prog.status}`,
        caption: prog.price || 'Price varies',
        body: prog.description || '',
        image_url: prog.image_url || 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=400',
        action: {
          label: "Reserve Spot",
          tool: "bookeo.create_hold",
          input: {
            eventId: prog.event_id || row.program_ref,
            productId: row.program_ref,
            org_ref: org_ref
          }
        }
      };
    });
    
    // Group by theme for cache
    const programsByTheme: Record<string, any[]> = {};
    for (const row of programs) {
      const prog = row.program as any;
      const theme = prog.category || 'All Programs';
      if (!programsByTheme[theme]) programsByTheme[theme] = [];
      programsByTheme[theme].push(prog);
    }
    
    return {
      success: true,
      data: {
        programs_by_theme: programsByTheme,
        total_programs: programs.length,
        org_ref,
        provider: 'bookeo'
      },
      session_token: undefined,
      ui: {
        cards: [{
          type: 'carousel',
          componentType: 'carousel',
          componentData: {
            type: "carousel",
            items: carouselItems
          }
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
 * Tool: bookeo.create_hold
 * Create a temporary booking hold and return confirmation card
 */
async function createHold(args: {
  eventId: string;
  productId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adults: number;
  children: number;
  org_ref: string;
}): Promise<ProviderResponse<any>> {
  const { eventId, productId, firstName, lastName, email, phone, adults, children, org_ref } = args;
  
  console.log(`[Bookeo] Creating hold for event: ${eventId}, product: ${productId}`);
  
  // Input validation
  if (!eventId || !productId || !firstName || !lastName || !email || adults < 0 || children < 0) {
    return {
      success: false,
      error: {
        message: 'Missing or invalid required fields',
        code: 'VALIDATION_ERROR',
        recovery_hint: 'Ensure all required fields are provided'
      }
    };
  }
  
  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      success: false,
      error: {
        message: 'Invalid email address',
        code: 'VALIDATION_ERROR',
        recovery_hint: 'Provide a valid email address'
      }
    };
  }
  
  try {
    // Call Bookeo API to create hold
    const holdPayload = {
      eventId,
      productId,
      customer: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email.trim(),
        phoneNumbers: phone ? [{ number: phone.trim() }] : []
      },
      participants: {
        numbers: { adults, children }
      }
    };
    
    const response = await fetch(`${BOOKEO_API_BASE}/holds`, {
      method: 'POST',
      headers: bookeoHeaders(),
      body: JSON.stringify(holdPayload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bookeo API error: ${response.status} ${errorText}`);
    }
    
    const holdData = await response.json();
    const holdId = holdData.holdId;
    const expiresAt = holdData.expirationTime;
    const totalCost = holdData.totalAmount || { amount: 0, currency: 'USD' };
    
    console.log(`[Bookeo] Hold created: ${holdId}, expires: ${expiresAt}`);
    
    // Get program name from cache
    const { data: programData } = await supabase
      .from('cached_provider_feed')
      .select('program')
      .eq('program_ref', productId)
      .single();
    
    const programName = (programData?.program as any)?.title || 'Program';
    
    return {
      success: true,
      data: {
        holdId,
        programName,
        totalCost,
        expiresAt
      },
      ui: {
        cards: [{
          type: 'confirmation',
          componentType: 'confirmation',
          componentData: {
            type: "confirmation",
            title: "Confirm Your Booking",
            body: `**Program:** ${programName}\n**Guests:** ${adults} adult(s), ${children} child(ren)\n**Total:** $${(totalCost.amount / 100).toFixed(2)}\n\nShall I confirm this booking?`,
            confirmAction: {
              label: "✅ Confirm Booking",
              tool: "bookeo.confirm_booking",
              input: {
                holdId,
                eventId,
                productId,
                firstName,
                lastName,
                email,
                phone,
                adults,
                children,
                org_ref
              }
            },
            cancelAction: {
              label: "❌ Cancel",
              response: "Understood. Booking request canceled."
            }
          }
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error creating hold:', error);
    return {
      success: false,
      error: {
        message: `Failed to create hold: ${error.message}`,
        code: 'BOOKEO_API_ERROR',
        recovery_hint: 'Check Bookeo API credentials and try again'
      }
    };
  }
}

/**
 * Tool: bookeo.confirm_booking
 * Confirm a booking from a hold
 */
async function confirmBooking(args: {
  holdId: string;
  eventId: string;
  productId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adults: number;
  children: number;
  org_ref: string;
}): Promise<ProviderResponse<any>> {
  const { holdId, eventId, productId, firstName, lastName, email, phone, adults, children, org_ref } = args;
  
  console.log(`[Bookeo] Confirming booking from hold: ${holdId}`);
  
  // Input validation
  if (!holdId || !eventId || !productId || !firstName || !lastName || !email) {
    return {
      success: false,
      error: {
        message: 'Missing required fields',
        code: 'VALIDATION_ERROR',
        recovery_hint: 'Ensure all required fields are provided'
      }
    };
  }
  
  try {
    // Call Bookeo API to finalize booking
    const bookingPayload = {
      holdId,
      customer: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email.trim(),
        phoneNumbers: phone ? [{ number: phone.trim() }] : []
      }
    };
    
    const response = await fetch(`${BOOKEO_API_BASE}/bookings`, {
      method: 'POST',
      headers: bookeoHeaders(),
      body: JSON.stringify(bookingPayload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bookeo API error: ${response.status} ${errorText}`);
    }
    
    const bookingData = await response.json();
    const bookingNumber = bookingData.bookingNumber;
    const startTime = bookingData.startTime;
    
    console.log(`[Bookeo] Booking confirmed: ${bookingNumber}`);
    
    // Get program name
    const { data: programData } = await supabase
      .from('cached_provider_feed')
      .select('program')
      .eq('program_ref', productId)
      .single();
    
    const programName = (programData?.program as any)?.title || 'Program';
    
    return {
      success: true,
      data: {
        bookingNumber,
        programName,
        startTime
      },
      ui: {
        cards: [{
          type: 'success',
          componentType: 'status',
          title: '✅ Booking Confirmed!',
          message: `**Booking #${bookingNumber}**\n\n${programName}\n${new Date(startTime).toLocaleString()}\n\nConfirmation email sent to ${email}`
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error confirming booking:', error);
    return {
      success: false,
      error: {
        message: `Failed to confirm booking: ${error.message}`,
        code: 'BOOKEO_API_ERROR',
        recovery_hint: 'Check Bookeo API and try again'
      }
    };
  }
}

/**
 * Export Bookeo tools
 */
export const bookeoTools: BookeoTool[] = [
  {
    name: 'bookeo.find_programs',
    description: 'Find available programs/products from Bookeo with carousel UI',
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
  },
  {
    name: 'bookeo.create_hold',
    description: 'Create a temporary booking hold with confirmation UI',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Bookeo event ID' },
        productId: { type: 'string', description: 'Bookeo product ID' },
        firstName: { type: 'string', description: 'Customer first name' },
        lastName: { type: 'string', description: 'Customer last name' },
        email: { type: 'string', format: 'email', description: 'Customer email' },
        phone: { type: 'string', description: 'Customer phone (optional)' },
        adults: { type: 'number', minimum: 0, description: 'Number of adults' },
        children: { type: 'number', minimum: 0, description: 'Number of children' },
        org_ref: { type: 'string', description: 'Organization reference' }
      },
      required: ['eventId', 'productId', 'firstName', 'lastName', 'email', 'adults', 'children', 'org_ref']
    },
    handler: async (args: any) => {
      return auditToolCall('bookeo.create_hold', args, () => createHold(args));
    }
  },
  {
    name: 'bookeo.confirm_booking',
    description: 'Confirm a booking from a hold',
    inputSchema: {
      type: 'object',
      properties: {
        holdId: { type: 'string', description: 'Hold ID from create_hold' },
        eventId: { type: 'string', description: 'Bookeo event ID' },
        productId: { type: 'string', description: 'Bookeo product ID' },
        firstName: { type: 'string', description: 'Customer first name' },
        lastName: { type: 'string', description: 'Customer last name' },
        email: { type: 'string', format: 'email', description: 'Customer email' },
        phone: { type: 'string', description: 'Customer phone (optional)' },
        adults: { type: 'number', minimum: 0, description: 'Number of adults' },
        children: { type: 'number', minimum: 0, description: 'Number of children' },
        org_ref: { type: 'string', description: 'Organization reference' }
      },
      required: ['holdId', 'eventId', 'productId', 'firstName', 'lastName', 'email', 'adults', 'children', 'org_ref']
    },
    handler: async (args: any) => {
      return auditToolCall('bookeo.confirm_booking', args, () => confirmBooking(args));
    }
  }
];
