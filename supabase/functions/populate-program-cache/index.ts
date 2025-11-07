/**
 * Populate Program Cache Edge Function
 * 
 * Discovers and caches program data including:
 * - Program cards (title, dates, price, etc.)
 * - Prerequisites schema (membership, waiver, payment, child info)
 * - Questions schema (color group, rentals, medical, etc.)
 * - Deep-links (registration_start, account_creation, program_details)
 * 
 * This enables cache-first, pre-login program discovery
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProgramData {
  program_ref: string;
  title: string;
  dates?: string;
  schedule_text?: string;
  age_range?: string;
  price?: string;
  status?: string;
  theme?: string;
  age_min?: number;
  age_max?: number;
}

interface PrerequisiteSchema {
  [programRef: string]: {
    [checkName: string]: {
      required: boolean;
      check: string;
      message: string;
    };
  };
}

interface QuestionsSchema {
  [programRef: string]: {
    fields: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      options?: Array<{ value: string; label: string }>;
      helper_text?: string;
      isPriceBearing?: boolean;
    }>;
  };
}

interface DeepLinksSchema {
  [programRef: string]: {
    registration_start: string;
    account_creation: string;
    program_details: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { org_ref, category = 'all', programs, ttl_hours = 24 } = await req.json();

    if (!org_ref || !programs || !Array.isArray(programs)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: org_ref and programs array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[CachePopulation] Processing ${programs.length} programs for ${org_ref}/${category}`);

    // Build enhanced cache data
    const prerequisitesSchema: PrerequisiteSchema = {};
    const questionsSchema: QuestionsSchema = {};
    const deepLinksSchema: DeepLinksSchema = {};

    for (const program of programs as ProgramData[]) {
      const programRef = program.program_ref;

      // Generate prerequisites schema
      prerequisitesSchema[programRef] = generatePrerequisitesSchema(programRef, program);

      // Generate questions schema
      questionsSchema[programRef] = generateQuestionsSchema(programRef, program);

      // Generate deep-links
      deepLinksSchema[programRef] = generateDeepLinks(org_ref, programRef);
    }

    // Group programs by theme
    const programsByTheme = groupProgramsByTheme(programs as ProgramData[]);

    // Upsert to cache
    const { data: cacheId, error: upsertError } = await supabase.rpc(
      'upsert_cached_programs_enhanced',
      {
        p_org_ref: org_ref,
        p_category: category,
        p_programs_by_theme: programsByTheme,
        p_prerequisites_schema: prerequisitesSchema,
        p_questions_schema: questionsSchema,
        p_deep_links: deepLinksSchema,
        p_metadata: {
          cached_by: 'populate-program-cache',
          programs_count: programs.length,
          cached_timestamp: new Date().toISOString()
        },
        p_ttl_hours: ttl_hours
      }
    );

    if (upsertError) {
      console.error('[CachePopulation] Upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to cache programs', details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[CachePopulation] Successfully cached ${programs.length} programs with ID: ${cacheId}`);

    return new Response(
      JSON.stringify({
        success: true,
        cache_id: cacheId,
        org_ref,
        category,
        programs_count: programs.length,
        cached_at: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CachePopulation] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Generate prerequisites schema for a program
 */
function generatePrerequisitesSchema(programRef: string, program: ProgramData) {
  // Standard prerequisites for SkiClubPro programs
  return {
    membership: {
      required: true,
      check: 'active_club_membership',
      message: 'Active club membership required'
    },
    waiver: {
      required: true,
      check: 'signed_waiver',
      message: 'Parent/guardian waiver must be signed'
    },
    payment_method: {
      required: true,
      check: 'payment_on_file',
      message: 'Credit card on file for registration'
    },
    child_profile: {
      required: true,
      check: 'complete_profile',
      message: 'Child name, DOB, emergency contact required'
    }
  };
}

/**
 * Generate questions schema for a program
 */
function generateQuestionsSchema(programRef: string, program: ProgramData) {
  // Standard questions for ski programs (can be enhanced with program-specific logic)
  const fields = [
    {
      id: 'color_group',
      label: 'Preferred Color Group',
      type: 'select',
      required: true,
      options: [
        { value: 'red', label: 'Red Group (Sundays 9-11am)' },
        { value: 'blue', label: 'Blue Group (Sundays 1-3pm)' },
        { value: 'green', label: 'Green Group (Saturdays 10am-12pm)' }
      ],
      helper_text: 'Each group has limited spots. We\'ll try to honor your preference.'
    },
    {
      id: 'equipment_rental',
      label: 'Equipment Rentals Needed?',
      type: 'checkbox',
      required: false,
      options: [
        { value: 'skis', label: 'Skis (+$25)' },
        { value: 'boots', label: 'Boots (+$15)' },
        { value: 'helmet', label: 'Helmet (+$10)' }
      ],
      isPriceBearing: true
    },
    {
      id: 'medical_conditions',
      label: 'Medical Conditions or Allergies',
      type: 'textarea',
      required: false,
      helper_text: 'Any conditions our instructors should know about'
    },
    {
      id: 'emergency_contact_name',
      label: 'Emergency Contact Name',
      type: 'text',
      required: true
    },
    {
      id: 'emergency_contact_phone',
      label: 'Emergency Contact Phone',
      type: 'tel',
      required: true
    }
  ];

  // Program-specific customization
  if (programRef.includes('nordic')) {
    fields.unshift({
      id: 'classic_or_skate',
      label: 'Skiing Style Preference',
      type: 'select',
      required: true,
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'skate', label: 'Skate' },
        { value: 'both', label: 'Both' }
      ],
      helper_text: 'Nordic skiing style preference'
    });
  }

  if (programRef.includes('racing') || programRef.includes('competition')) {
    fields.push({
      id: 'ussa_number',
      label: 'USSA Number (if applicable)',
      type: 'text',
      required: false,
      helper_text: 'U.S. Ski & Snowboard membership number'
    });
  }

  return { fields };
}

/**
 * Generate deep-links for a program
 */
function generateDeepLinks(orgRef: string, programRef: string) {
  // Resolve base URL (single source of truth)
  const baseUrl = orgRef === 'blackhawk-ski' || orgRef === 'blackhawk-ski-club'
    ? 'https://blackhawk.skiclubpro.team'
    : `https://${orgRef}.skiclubpro.team`;

  const params = 'ref=signupassist&utm_source=chatgpt_app&utm_medium=acp';

  return {
    registration_start: `${baseUrl}/registration/${programRef}/start?${params}`,
    account_creation: `${baseUrl}/user/register?${params}&prefill=guardian`,
    program_details: `${baseUrl}/registration/${programRef}?${params}`
  };
}

/**
 * Group programs by theme
 */
function groupProgramsByTheme(programs: ProgramData[]) {
  const grouped: { [theme: string]: ProgramData[] } = {};

  for (const program of programs) {
    const theme = program.theme || 'general';
    if (!grouped[theme]) {
      grouped[theme] = [];
    }
    grouped[theme].push(program);
  }

  return grouped;
}
