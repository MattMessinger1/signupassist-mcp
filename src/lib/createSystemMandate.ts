import { supabase } from '@/integrations/supabase/client';

/**
 * Helper to invoke create-system-mandate edge function
 */
export async function createSystemMandate(userId: string) {
  const { data, error } = await supabase.functions.invoke('create-system-mandate', {
    body: {
      user_id: userId,
      scopes: ['scp:authenticate', 'scp:discover:fields', 'scp:find_programs'],
      valid_duration_minutes: 10080 // 7 days
    }
  });

  if (error) {
    console.error('Failed to create system mandate:', error);
    throw error;
  }

  return data;
}
