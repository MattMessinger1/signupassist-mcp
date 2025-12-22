/**
 * Bookeo Provider - MCP Tools for Bookeo automation
 * API-based provider using Bookeo REST API v2
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';
import { getPlaceholderImage } from '../lib/placeholderImages.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Bookeo API credentials
const BOOKEO_API_KEY = process.env.BOOKEO_API_KEY!;
const BOOKEO_SECRET_KEY = process.env.BOOKEO_SECRET_KEY!;
const BOOKEO_API_BASE = 'https://api.bookeo.com/v2';

/**
 * Build Bookeo API URL with authentication in query params
 * More reliable than header-based auth from certain environments
 */
function buildBookeoUrl(
  path: string, 
  extraParams?: Record<string, string | number | boolean>
): string {
  const url = new URL(`${BOOKEO_API_BASE}${path}`);
  url.searchParams.set('apiKey', BOOKEO_API_KEY);
  url.searchParams.set('secretKey', BOOKEO_SECRET_KEY);
  
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, String(value));
    }
  }
  
  return url.toString();
}

/**
 * Minimal headers - auth is now in query string
 */
function bookeoHeadersMinimal() {
  return {
    'Content-Type': 'application/json'
  };
}

export interface BookeoTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
  /** Optional safety metadata for OpenAI safety gating */
  _meta?: {
    'openai/safety'?: 'read-only' | 'write' | 'sensitive';
  };
}

/**
 * Strip HTML tags and decode entities from text
 */
function stripHtml(html: string): string {
  if (!html) return '';
  
  // Decode common HTML entities FIRST (before stripping tags)
  const entities: Record<string, string> = {
    '&rarr;': '→',
    '&larr;': '←',
    '&ndash;': '–',
    '&mdash;': '—',
    '&rsquo;': "'",
    '&lsquo;': "'",
    '&rdquo;': '"',
    '&ldquo;': '"',
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"'
  };
  
  let text = html;
  Object.entries(entities).forEach(([entity, char]) => {
    text = text.replace(new RegExp(entity, 'g'), char);
  });
  
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  
  // Remove structural prefixes like "Description → Section: General" ANYWHERE in text
  text = text.replace(/Description\s*→\s*Section:\s*\w+/gi, '');
  
  // Clean up excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
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
      // .filter('program->>status', 'in', '(Open,Register)')
      // .gte('program->signup_start_time', nowIso)
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
            title: 'No Programs Available',
            description: 'There are no upcoming programs available at this time.'
          }]
        }
      };
    }
    
    console.log(`[Bookeo] Found ${programs.length} programs`);
    
    // Group by theme (category) for UI display
    const programsByTheme: Record<string, any[]> = {};
    for (const row of programs) {
      const prog = row.program as any;
      const theme = determineTheme(prog.title || '', prog.category);
      if (!programsByTheme[theme]) programsByTheme[theme] = [];
      programsByTheme[theme].push({
        ...prog,
        program_ref: row.program_ref,
        org_ref: row.org_ref
      });
    }
    
    // Build grouped card payload (ChatGPT-compatible format)
    const groups = Object.entries(programsByTheme).map(([themeName, progs]) => ({
      title: themeName,
      cards: progs.map(prog => ({
        title: prog.title || 'Untitled Program',
        subtitle: `Status: ${prog.status || 'TBD'}`,
        image_url: prog.image_url || prog.imageUrl || prog.thumbnail || getPlaceholderImage(prog.title || '', prog.category),
        caption: [
          prog.price || 'Price varies',
          prog.signup_start_time ? new Date(prog.signup_start_time).toLocaleDateString() : 'Date TBD'
        ].join(' • '),
        body: stripHtml(prog.description || ''),
        program_ref: prog.program_ref,
        org_ref: prog.org_ref,
        actions: [
          {
            type: 'postback',
            label: 'View Details',
            payload: {
              intent: 'view_program_details',
              program_ref: prog.program_ref,
              org_ref: prog.org_ref
            }
          }
        ]
      }))
    }));
    
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
        message: `Found ${programs.length} programs available at ${org_ref}`,
        cards: groups
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error finding programs:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to load programs at this time',
      recovery: 'Please check your organization settings and try again',
      severity: 'medium',
      code: 'BOOKEO_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: bookeo.discover_required_fields
 * Discovers required fields for a specific Bookeo product
 * Reads from cached_provider_feed table (synced by sync-bookeo edge function)
 */
async function discoverRequiredFields(args: {
  program_ref: string;
  org_ref: string;
  user_jwt?: string;
  mandate_jws?: string;
}): Promise<ProviderResponse<any>> {
  const { program_ref, org_ref } = args;
  
  console.log(`[Bookeo] Discovering fields for program: ${program_ref} (reading from database cache)`);
  
  try {
    // Fetch pre-stored signup form from database (already synced by sync-bookeo)
    const { data, error } = await supabase
      .from('cached_provider_feed')
      .select('signup_form, program')
      .eq('program_ref', program_ref)
      .eq('org_ref', org_ref)
      .single();
    
    if (error || !data) {
      console.error('[Bookeo] Program not found in cache:', error);
      throw new Error(`Program not found: ${program_ref}`);
    }
    
    const signupForm = data.signup_form as any;
    const programData = data.program as any;

    // Validate two-tier schema structure
    const hasDelegateFields = Array.isArray(signupForm?.delegate_fields);
    const hasParticipantFields = Array.isArray(signupForm?.participant_fields);

    if (!hasDelegateFields || !hasParticipantFields) {
      console.warn('[Bookeo] Invalid two-tier schema in cache for program:', program_ref);
      console.warn('[Bookeo] Schema structure:', { 
        hasDelegateFields, 
        hasParticipantFields,
        delegateCount: signupForm?.delegate_fields?.length || 0,
        participantCount: signupForm?.participant_fields?.length || 0
      });
      throw new Error('Invalid form schema: missing delegate_fields or participant_fields');
    }

    const delegateFieldCount = signupForm.delegate_fields.length;
    const participantFieldCount = signupForm.participant_fields.length;

    console.log(`[Bookeo] Found two-tier schema: ${delegateFieldCount} delegate fields, ${participantFieldCount} participant fields`);

    return {
      success: true,
      data: {
        program_ref,
        program_questions: signupForm, // Return entire schema with delegate_fields + participant_fields
        metadata: {
          product_name: programData.title,
          duration: programData.duration,
          max_participants: signupForm.max_participants || 10,
          requires_age_verification: signupForm.requires_age_verification || true,
          minimum_delegate_age: signupForm.minimum_delegate_age || 18,
          discovered_at: new Date().toISOString(),
          source: 'database_cache'
        }
      },
      session_token: undefined,
      ui: {
        cards: [{
          title: 'Registration Form',
          description: `Two-tier form: Delegate info + ${signupForm.max_participants || 10} participants max`
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error discovering fields:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to retrieve program details',
      recovery: 'Please verify the program is synced and try again',
      severity: 'medium',
      code: 'DATABASE_ERROR'
    };
    return {
      success: false,
      error: friendlyError
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
    const friendlyError: ParentFriendlyError = {
      display: 'Please provide all required information',
      recovery: 'Ensure first name, last name, email, and number of guests are provided',
      severity: 'low',
      code: 'VALIDATION_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
  
  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    const friendlyError: ParentFriendlyError = {
      display: 'Invalid email address',
      recovery: 'Please provide a valid email address',
      severity: 'low',
      code: 'VALIDATION_ERROR'
    };
    return {
      success: false,
      error: friendlyError
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
        numbers: [
          ...(adults > 0 ? [{ peopleCategoryId: 'Cadults', number: adults }] : []),
          ...(children > 0 ? [{ peopleCategoryId: 'Cchildren', number: children }] : [])
        ]
      }
    };
    
    const url = buildBookeoUrl('/holds');
    console.log('[Bookeo] POST /holds URL (redacted):', url
      .replace(BOOKEO_API_KEY, 'API_KEY')
      .replace(BOOKEO_SECRET_KEY, 'SECRET_KEY'));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: bookeoHeadersMinimal(),
      body: JSON.stringify(holdPayload)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const friendlyError: ParentFriendlyError = {
        display: errorData.message || 'Failed to create booking hold',
        recovery: 'Please try again or contact support if the issue persists',
        severity: 'medium',
        code: 'BOOKEO_API_ERROR'
      };
      return {
        success: false,
        error: friendlyError
      };
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
          title: 'Confirm Your Booking',
          description: `**Program:** ${programName}\n**Guests:** ${adults} adult(s), ${children} child(ren)\n**Total:** $${(totalCost.amount / 100).toFixed(2)}\n\nShall I confirm this booking?`,
          metadata: {
            componentType: 'confirmation',
            componentData: {
              type: "confirmation",
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
          }
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error creating hold:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to process booking at this time',
      recovery: 'Please check your connection and try again',
      severity: 'high',
      code: 'BOOKEO_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: bookeo.confirm_booking
 * Create a direct booking with two-tier form data (delegate + participants)
 * No hold required - books immediately
 */
async function confirmBooking(args: {
  event_id: string;
  program_ref: string;
  org_ref: string;
  delegate_data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth: string;
    relationship: string;
  };
  participant_data: Array<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    grade?: string;
    // allergies field REMOVED for ChatGPT App Store compliance (PHI prohibition)
  }>;
  num_participants: number;
}): Promise<ProviderResponse<any>> {
  const { event_id, program_ref, org_ref, delegate_data, participant_data, num_participants } = args;
  
  console.log(`[Bookeo] Creating direct booking for event: ${event_id}`);
  
  // Input validation
  if (!event_id || !program_ref || !delegate_data || !participant_data || num_participants < 1) {
    const friendlyError: ParentFriendlyError = {
      display: 'Missing required booking information',
      recovery: 'Please provide event ID, delegate info, and at least one participant',
      severity: 'medium',
      code: 'VALIDATION_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
  
  // Validate eventId format - Bookeo slot eventIds are typically "productId_something_YYYY-MM-DD"
  // Plain productIds lack underscores and would cause INVALID_EVENT_ID error
  const looksLikePlainProductId = !event_id || event_id === program_ref || !event_id.includes('_');
  
  if (looksLikePlainProductId) {
    console.error(`[Bookeo] ❌ Refusing to create booking: eventId "${event_id}" looks like a productId (should be full slot eventId with underscores)`);
    const friendlyError: ParentFriendlyError = {
      display: 'Invalid booking slot reference',
      recovery: 'Please refresh the program list and try again',
      severity: 'high',
      code: 'INVALID_EVENT_ID'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
  
  try {
    // Fetch program data to get the correct people category
    const { data: programData, error: dbError } = await supabase
      .from('cached_provider_feed')
      .select('program')
      .eq('program_ref', program_ref)
      .eq('org_ref', org_ref)
      .single();
    
    if (dbError || !programData) {
      console.error('[Bookeo] Failed to fetch program data:', dbError);
      const friendlyError: ParentFriendlyError = {
        display: 'Program information not found',
        recovery: 'Please refresh the program list and try again',
        severity: 'high',
        code: 'PROGRAM_NOT_FOUND'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    const peopleCategoryId = (programData.program as any)?.people_category_id || 'Cadults';
    console.log(`[Bookeo] Using people category: ${peopleCategoryId} for program ${program_ref}`);
    
    // Build Bookeo API payload
    const bookingPayload = {
      eventId: event_id,
      productId: program_ref,
      customer: {
        firstName: delegate_data.firstName.trim(),
        lastName: delegate_data.lastName.trim(),
        emailAddress: delegate_data.email.trim(),
        phoneNumbers: delegate_data.phone ? [{ number: delegate_data.phone.trim() }] : []
      },
      participants: {
        numbers: [
          { peopleCategoryId, number: num_participants }
        ]
      }
    };
    
    console.log(`[Bookeo] Booking payload:`, JSON.stringify(bookingPayload, null, 2));
    
    const url = buildBookeoUrl('/bookings');
    console.log('[Bookeo] POST /bookings URL (redacted):', url
      .replace(BOOKEO_API_KEY, 'API_KEY')
      .replace(BOOKEO_SECRET_KEY, 'SECRET_KEY'));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: bookeoHeadersMinimal(),
      body: JSON.stringify(bookingPayload)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[Bookeo] API error:`, errorData);
      const friendlyError: ParentFriendlyError = {
        display: errorData.message || 'Failed to create booking',
        recovery: 'Please verify all information and try again, or contact support',
        severity: 'high',
        code: 'BOOKEO_API_ERROR'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    const bookingData = await response.json();
    const bookingNumber = bookingData.bookingNumber;
    const startTime = bookingData.startTime;
    
    console.log(`[Bookeo] Booking confirmed: ${bookingNumber}`);
    
    // Get program details from cache for display
    const { data: programDetails } = await supabase
      .from('cached_provider_feed')
      .select('program')
      .eq('program_ref', program_ref)
      .eq('org_ref', org_ref)
      .single();
    
    const programName = (programDetails?.program as any)?.title || 'Program';
    
    return {
      success: true,
      data: {
        booking_number: bookingNumber,
        program_name: programName,
        start_time: startTime,
        num_participants
      },
      ui: {
        cards: [{
          title: '✅ Booking Confirmed!',
          description: `**Booking #${bookingNumber}**\n\n${programName}\n${new Date(startTime).toLocaleString()}\n\nAIM Design will send confirmation to ${delegate_data.email}`
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error confirming booking:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to complete booking',
      recovery: 'Please try again or contact support',
      severity: 'high',
      code: 'BOOKEO_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: bookeo.cancel_booking
 * Cancel an existing Bookeo booking
 * Returns success if provider accepts, failure if blocked by policy
 */
async function cancelBooking(args: {
  booking_number: string;
  org_ref: string;
}): Promise<ProviderResponse<any>> {
  const { booking_number, org_ref } = args;
  
  console.log(`[Bookeo] Cancelling booking: ${booking_number}`);
  
  if (!booking_number) {
    const friendlyError: ParentFriendlyError = {
      display: 'Missing booking number',
      recovery: 'Unable to cancel without a booking reference',
      severity: 'medium',
      code: 'VALIDATION_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
  
  try {
    // Call Bookeo API to cancel booking
    const url = buildBookeoUrl(`/bookings/${booking_number}`);
    console.log('[Bookeo] DELETE /bookings URL (redacted):', url
      .replace(BOOKEO_API_KEY, 'API_KEY')
      .replace(BOOKEO_SECRET_KEY, 'SECRET_KEY'));
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: bookeoHeadersMinimal()
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[Bookeo] Cancel failed:`, response.status, errorData);
      
      // Provider-specific error handling
      if (response.status === 404) {
        const friendlyError: ParentFriendlyError = {
          display: 'Booking not found',
          recovery: 'This booking may have already been cancelled or does not exist',
          severity: 'medium',
          code: 'BOOKING_NOT_FOUND'
        };
        return {
          success: false,
          error: friendlyError
        };
      }
      
      if (response.status === 400 || response.status === 403) {
        // Provider blocked cancellation (policy violation)
        const friendlyError: ParentFriendlyError = {
          display: errorData.message || 'Cancellation not allowed',
          recovery: 'The provider\'s cancellation policy may prevent this. Please contact them directly.',
          severity: 'medium',
          code: 'CANCELLATION_BLOCKED'
        };
        return {
          success: false,
          error: friendlyError
        };
      }
      
      const friendlyError: ParentFriendlyError = {
        display: errorData.message || 'Failed to cancel booking',
        recovery: 'Please try again or contact support',
        severity: 'high',
        code: 'BOOKEO_API_ERROR'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    console.log(`[Bookeo] ✅ Booking cancelled: ${booking_number}`);
    
    return {
      success: true,
      data: {
        booking_number,
        cancelled: true,
        cancelled_at: new Date().toISOString()
      },
      ui: {
        cards: [{
          title: '✅ Booking Cancelled',
          description: `Booking #${booking_number} has been cancelled with the provider.`
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Bookeo] Error cancelling booking:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to cancel booking',
      recovery: 'Please try again or contact the provider directly',
      severity: 'high',
      code: 'BOOKEO_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: bookeo.test_connection
 * Diagnostic tool to verify Bookeo API credentials from Railway
 * Calls /settings/apikeyinfo - the exact same endpoint as the working curl test
 */
async function testConnection(): Promise<any> {
  console.log('[Bookeo Test] Testing connection: GET /settings/apikeyinfo');
  
  try {
    const url = buildBookeoUrl('/settings/apikeyinfo');
    console.log('[Bookeo Test] GET', url.replace(BOOKEO_SECRET_KEY, '***'));
    
    const response = await fetch(url, {
      method: 'GET',
      headers: bookeoHeadersMinimal()
    });
    
    const text = await response.text();
    console.log('[Bookeo Test] status', response.status, 'body', text);
    
    return {
      status: response.status,
      raw: text,
      success: response.ok,
      message: response.ok 
        ? '✅ Bookeo credentials verified from Railway' 
        : '❌ Bookeo authentication failed from Railway'
    };
  } catch (error) {
    console.error('[Bookeo Test] EXCEPTION:', error);
    return {
      status: 0,
      raw: '',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: '❌ Bookeo test connection failed with exception'
    };
  }
}

/**
 * Export Bookeo tools
 */
export const bookeoTools: BookeoTool[] = [
  {
    name: 'bookeo.test_connection',
    description: 'Diagnostic tool to test Bookeo API credentials with a READ operation',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: async () => {
      return testConnection();
    }
  },
  {
    name: 'bookeo.find_programs',
    description: `Read-only discovery tool.
Returns a list of available AIM Design programs (classes, camps, events) and metadata.
Does NOT create bookings.
Does NOT charge payments.
Does NOT modify user data.
Safe to call for browsing and exploration.`,
    _meta: {
      'openai/safety': 'read-only'
    },
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
      return auditToolCall(
        { plan_execution_id: null, tool: 'bookeo.find_programs' },
        args,
        () => findPrograms(args)
      );
    }
  },
  {
    name: 'bookeo.discover_required_fields',
    description: `Read-only discovery tool.
Returns the required form fields for a specific program (delegate + participant fields).
Does NOT create bookings.
Does NOT charge payments.
Does NOT modify user data.
Safe to call for exploring registration requirements.`,
    _meta: {
      'openai/safety': 'read-only'
    },
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
      return auditToolCall(
        { plan_execution_id: null, tool: 'bookeo.discover_required_fields' },
        args,
        () => discoverRequiredFields(args)
      );
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
      return auditToolCall(
        { plan_execution_id: null, tool: 'bookeo.create_hold' },
        args,
        () => createHold(args)
      );
    }
  },
  {
    name: 'bookeo.confirm_booking',
    description: 'Create a direct booking with two-tier form data (delegate + participants)',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Bookeo event ID' },
        program_ref: { type: 'string', description: 'Bookeo product/program ID' },
        org_ref: { type: 'string', description: 'Organization reference' },
        delegate_data: {
          type: 'object',
          description: 'Responsible delegate information',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            dateOfBirth: { type: 'string' },
            relationship: { type: 'string' }
          },
          required: ['firstName', 'lastName', 'email', 'dateOfBirth', 'relationship']
        },
        participant_data: {
          type: 'array',
          description: 'Array of participant details',
          items: {
            type: 'object',
            properties: {
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              dateOfBirth: { type: 'string' },
              grade: { type: 'string' }
              // allergies field REMOVED for ChatGPT App Store compliance (PHI prohibition)
            },
            required: ['firstName', 'lastName', 'dateOfBirth']
          }
        },
        num_participants: { type: 'number', description: 'Number of participants' }
      },
      required: ['event_id', 'program_ref', 'org_ref', 'delegate_data', 'participant_data', 'num_participants']
    },
    handler: async (args: any) => {
      // Extract audit context from args (injected by APIOrchestrator.invokeMCPTool)
      const { _audit, ...toolArgs } = args;
      return auditToolCall(
        { 
          plan_execution_id: _audit?.plan_execution_id || null, 
          mandate_id: _audit?.mandate_id,
          user_id: _audit?.user_id,
          tool: 'bookeo.confirm_booking' 
        },
        toolArgs,
        () => confirmBooking(toolArgs)
      );
    }
  },
  {
    name: 'bookeo.cancel_booking',
    description: 'Cancel an existing Bookeo booking (subject to provider cancellation policy)',
    inputSchema: {
      type: 'object',
      properties: {
        booking_number: { type: 'string', description: 'Bookeo booking number to cancel' },
        org_ref: { type: 'string', description: 'Organization reference' }
      },
      required: ['booking_number', 'org_ref']
    },
    handler: async (args: any) => {
      // Extract audit context from args (injected by APIOrchestrator.invokeMCPTool)
      const { _audit, ...toolArgs } = args;
      return auditToolCall(
        { 
          plan_execution_id: _audit?.plan_execution_id || null, 
          mandate_id: _audit?.mandate_id,
          user_id: _audit?.user_id,
          tool: 'bookeo.cancel_booking' 
        },
        toolArgs,
        () => cancelBooking(toolArgs)
      );
    }
  }
];

/**
 * Multi-backend program discovery (direct database query)
 * Used by AIOrchestrator for browse mode bypass
 */
export async function findProgramsMultiBackend(
  orgRef: string, 
  provider: string
): Promise<Array<{ ref: string; title: string; description: string; schedule?: string; price?: string; status?: string }>> {
  console.log(`[Bookeo] findProgramsMultiBackend: ${orgRef}, ${provider}`);
  
  try {
    const { data: programs, error } = await supabase
      .from('cached_provider_feed')
      .select('program_ref, program, org_ref')
      .eq('org_ref', orgRef)
      .order('program->signup_start_time', { ascending: true })
      .limit(20);
    
    if (error) {
      console.error('[Bookeo] Database error:', error);
      return [];
    }
    
    if (!programs || programs.length === 0) {
      console.log('[Bookeo] No programs found');
      return [];
    }
    
    console.log(`[Bookeo] Found ${programs.length} programs`);
    
    // Transform to simple format
    return programs.map(row => {
      const prog = row.program as any;
      return {
        ref: row.program_ref,
        title: prog.title || 'Untitled Program',
        description: stripHtml(prog.description || ''),
        schedule: prog.schedule || '',
        price: prog.price || 'Price varies',
        status: prog.status || ''
      };
    });
    
  } catch (error: any) {
    console.error('[Bookeo] Error in findProgramsMultiBackend:', error);
    return [];
  }
}
