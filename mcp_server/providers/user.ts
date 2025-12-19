/**
 * User Provider - MCP Tools for user data operations (children, billing)
 * ChatGPT App Store Compliant: All operations are auditable with mandate verification
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';
import Logger from '../utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface UserTool {
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
 * Child record structure
 */
export interface ChildRecord {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  dob?: string;
  created_at: string;
}

/**
 * Payment method info (minimal, no sensitive data)
 */
export interface PaymentMethodInfo {
  has_payment_method: boolean;
  last4?: string;
  brand?: string;
  payment_method_id?: string;
}

/**
 * Delegate profile structure (for parent/guardian info persistence)
 * Note: phone and email stored directly (Supabase encrypts at rest)
 */
export interface DelegateProfile {
  id?: string;
  user_id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;
  default_relationship?: string;
  city?: string;      // For location-based provider matching
  state?: string;     // For location-based provider matching
}

/**
 * Tool: user.list_children
 * Lists saved children for a user (audited for compliance)
 * Required scope: user:read:children
 */
async function listChildren(args: {
  user_id: string;
}): Promise<ProviderResponse<{ children: ChildRecord[] }>> {
  const { user_id } = args;
  
  console.log(`[User] Listing children for user: ${user_id}`);
  
  try {
    const { data: children, error } = await supabase
      .from('children')
      .select('id, user_id, first_name, last_name, dob, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('[User] Database error listing children:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to load your saved children',
        recovery: 'Please try again in a moment.',
        severity: 'low',
        code: 'USER_LIST_CHILDREN_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    console.log(`[User] ✅ Found ${children?.length || 0} children for user`);
    
    return {
      success: true,
      data: { children: (children || []) as ChildRecord[] }
    };
    
  } catch (error: any) {
    console.error('[User] Error listing children:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to load your saved children',
      recovery: 'Please try again in a moment.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Tool: user.create_child
 * Creates a new saved child for a user (audited for compliance)
 * Required scope: user:write:children
 */
async function createChild(args: {
  user_id: string;
  first_name: string;
  last_name: string;
  dob?: string;
}): Promise<ProviderResponse<{ child: ChildRecord }>> {
  const { user_id, first_name, last_name, dob } = args;
  
  console.log(`[User] Creating child for user: ${user_id}, name: ${first_name} ${last_name}`);
  
  try {
    const { data: child, error } = await supabase
      .from('children')
      .insert({
        user_id,
        first_name,
        last_name,
        dob
      })
      .select()
      .single();
    
    if (error) {
      console.error('[User] Database error creating child:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to save child information',
        recovery: 'Please try again.',
        severity: 'low',
        code: 'USER_CREATE_CHILD_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    console.log(`[User] ✅ Child created: ${child.id}`);
    
    return {
      success: true,
      data: { child: child as ChildRecord }
    };
    
  } catch (error: any) {
    console.error('[User] Error creating child:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to save child information',
      recovery: 'Please try again.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Tool: user.check_payment_method
 * Checks if user has a saved payment method (audited for compliance)
 * Required scope: user:read:billing
 */
async function checkPaymentMethod(args: {
  user_id: string;
}): Promise<ProviderResponse<PaymentMethodInfo>> {
  const { user_id } = args;
  
  console.log(`[User] Checking payment method for user: ${user_id}`);
  
  try {
    const { data: billing, error } = await supabase
      .from('user_billing')
      .select('default_payment_method_id, payment_method_last4, payment_method_brand')
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (error) {
      console.error('[User] Database error checking payment method:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to check payment information',
        recovery: 'Please try again.',
        severity: 'low',
        code: 'USER_CHECK_PAYMENT_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    const hasPaymentMethod = !!(billing?.default_payment_method_id);
    
    console.log(`[User] ✅ Payment method check: ${hasPaymentMethod ? 'Found' : 'Not found'}`);
    
    return {
      success: true,
      data: {
        has_payment_method: hasPaymentMethod,
        last4: billing?.payment_method_last4 || undefined,
        brand: billing?.payment_method_brand || undefined,
        payment_method_id: billing?.default_payment_method_id || undefined
      }
    };
    
  } catch (error: any) {
    console.error('[User] Error checking payment method:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to check payment information',
      recovery: 'Please try again.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Tool: user.update_child
 * Updates an existing child record (audited for compliance)
 * Required scope: user:write:children
 */
async function updateChild(args: {
  user_id: string;
  child_id: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
}): Promise<ProviderResponse<{ child: ChildRecord }>> {
  const { user_id, child_id, first_name, last_name, dob } = args;
  
  console.log(`[User] Updating child: ${child_id} for user: ${user_id}`);
  
  try {
    // First verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('children')
      .select('*')
      .eq('id', child_id)
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (fetchError || !existing) {
      console.error('[User] Child not found or access denied');
      const friendlyError: ParentFriendlyError = {
        display: 'Child record not found',
        recovery: 'The child may have been removed.',
        severity: 'low',
        code: 'USER_CHILD_NOT_FOUND'
      };
      return { success: false, error: friendlyError };
    }
    
    // Build update object
    const updates: any = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (dob !== undefined) updates.dob = dob;
    
    const { data: child, error } = await supabase
      .from('children')
      .update(updates)
      .eq('id', child_id)
      .eq('user_id', user_id)
      .select()
      .single();
    
    if (error) {
      console.error('[User] Database error updating child:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to update child information',
        recovery: 'Please try again.',
        severity: 'low',
        code: 'USER_UPDATE_CHILD_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    console.log(`[User] ✅ Child updated: ${child.id}`);
    
    return {
      success: true,
      data: { child: child as ChildRecord }
    };
    
  } catch (error: any) {
    console.error('[User] Error updating child:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to update child information',
      recovery: 'Please try again.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Tool: user.get_delegate_profile
 * Gets the delegate profile for a user (audited for compliance)
 * Required scope: user:read:profile
 */
async function getDelegateProfile(args: {
  user_id: string;
}): Promise<ProviderResponse<{ profile: DelegateProfile | null }>> {
  const { user_id } = args;
  
  Logger.info('[User] Getting delegate profile', { user_id });
  
  try {
    const { data: profile, error } = await supabase
      .from('delegate_profiles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (error) {
      Logger.error('[User] Database error getting delegate profile', { error });
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to load your profile',
        recovery: 'Please try again in a moment.',
        severity: 'low',
        code: 'USER_GET_PROFILE_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    if (!profile) {
      Logger.info('[User] No delegate profile found for user');
      return { success: true, data: { profile: null } };
    }
    
    Logger.info('[User] Delegate profile retrieved successfully');
    
    return {
      success: true,
      data: { profile: profile as DelegateProfile }
    };
    
  } catch (error: any) {
    Logger.error('[User] Error getting delegate profile', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to load your profile',
      recovery: 'Please try again in a moment.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Tool: user.update_delegate_profile
 * Updates or creates delegate profile (audited for compliance)
 * Required scope: user:write:profile
 * 
 * PII stored directly - Supabase encrypts data at rest
 */
async function updateDelegateProfile(args: {
  user_id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;
  default_relationship?: string;
  city?: string;
  state?: string;
}): Promise<ProviderResponse<{ profile: DelegateProfile }>> {
  const { user_id, first_name, last_name, phone, email, date_of_birth, default_relationship, city, state } = args;
  
  Logger.info('[User] Updating delegate profile', { user_id });
  
  try {
    const updates: any = { user_id };
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (date_of_birth !== undefined) updates.date_of_birth = date_of_birth;
    if (default_relationship !== undefined) updates.default_relationship = default_relationship;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (phone !== undefined) updates.phone = phone;
    // Note: email stored in auth.users, but can be cached here if needed
    
    const { data: profile, error } = await supabase
      .from('delegate_profiles')
      .upsert(updates, { onConflict: 'user_id' })
      .select()
      .single();
    
    if (error) {
      Logger.error('[User] Database error updating delegate profile', { error });
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to save your profile',
        recovery: 'Please try again.',
        severity: 'low',
        code: 'USER_UPDATE_PROFILE_FAILED'
      };
      return { success: false, error: friendlyError };
    }
    
    Logger.info('[User] Delegate profile updated successfully', { user_id });
    
    return {
      success: true,
      data: { profile: profile as DelegateProfile }
    };
    
  } catch (error: any) {
    Logger.error('[User] Error updating delegate profile', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to save your profile',
      recovery: 'Please try again.',
      severity: 'low',
      code: 'USER_API_ERROR'
    };
    return { success: false, error: friendlyError };
  }
}

/**
 * Export User tools for MCP server registration
 */
export const userTools: UserTool[] = [
  {
    name: 'user.list_children',
    description: 'List saved children for a user (requires user:read:children scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        }
      },
      required: ['user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.list_children', mandate_id: args._audit?.mandate_id },
        args,
        () => listChildren(args)
      );
    }
  },
  {
    name: 'user.create_child',
    description: 'Create a new saved child for a user (requires user:write:children scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        first_name: {
          type: 'string',
          description: 'Child\'s first name'
        },
        last_name: {
          type: 'string',
          description: 'Child\'s last name'
        },
        dob: {
          type: 'string',
          description: 'Child\'s date of birth (ISO 8601 date)'
        }
      },
      required: ['user_id', 'first_name', 'last_name']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.create_child', mandate_id: args._audit?.mandate_id },
        args,
        () => createChild(args)
      );
    }
  },
  {
    name: 'user.check_payment_method',
    description: 'Check if user has a saved payment method (requires user:read:billing scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        }
      },
      required: ['user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.check_payment_method', mandate_id: args._audit?.mandate_id },
        args,
        () => checkPaymentMethod(args)
      );
    }
  },
  {
    name: 'user.update_child',
    description: 'Update an existing child record (requires user:write:children scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        child_id: {
          type: 'string',
          description: 'Child record ID to update'
        },
        first_name: {
          type: 'string',
          description: 'Child\'s first name'
        },
        last_name: {
          type: 'string',
          description: 'Child\'s last name'
        },
        dob: {
          type: 'string',
          description: 'Child\'s date of birth (ISO 8601 date)'
        }
      },
      required: ['user_id', 'child_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.update_child', mandate_id: args._audit?.mandate_id },
        args,
        () => updateChild(args)
      );
    }
  },
  {
    name: 'user.get_delegate_profile',
    description: 'Get delegate profile for a user (requires user:read:profile scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        }
      },
      required: ['user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.get_delegate_profile', mandate_id: args._audit?.mandate_id },
        args,
        () => getDelegateProfile(args)
      );
    }
  },
  {
    name: 'user.update_delegate_profile',
    description: 'Update or create delegate profile (requires user:write:profile scope)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        first_name: {
          type: 'string',
          description: 'Delegate first name'
        },
        last_name: {
          type: 'string',
          description: 'Delegate last name'
        },
        phone: {
          type: 'string',
          description: 'Delegate phone number'
        },
        date_of_birth: {
          type: 'string',
          description: 'Delegate date of birth (ISO 8601 date)'
        },
        default_relationship: {
          type: 'string',
          description: 'Default relationship to participants (parent, guardian, grandparent, other)'
        },
        city: {
          type: 'string',
          description: 'User city for location-based provider matching'
        },
        state: {
          type: 'string',
          description: 'User state/province for location-based provider matching'
        }
      },
      required: ['user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'user.update_delegate_profile', mandate_id: args._audit?.mandate_id },
        args,
        () => updateDelegateProfile(args)
      );
    }
  }
];
