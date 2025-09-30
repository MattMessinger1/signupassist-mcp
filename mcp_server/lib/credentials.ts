/**
 * Credential Management for MCP Providers
 * Handles secure storage and retrieval of provider credentials
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for backend operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface SkiClubProCredentials {
  email: string;
  password: string;
}

export interface StoredCredential {
  alias: string;
  provider: string;
  user_id: string;
  encrypted_data: string;
  created_at: string;
}

/**
 * Look up credentials by ID using Supabase cred-get edge function
 * This ensures consistent decryption using the deployed edge function
 */
export async function lookupCredentialsById(
  credential_id: string,
  userJwt: string
): Promise<SkiClubProCredentials> {
  try {
    if (!userJwt) {
      throw new Error('User JWT is required for credential lookup');
    }

    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userJwt}`,  // Use user's JWT for proper scoping
      'apikey': supabaseAnonKey,  // Use anon key, not service role
    };

    const response = await fetch(`${supabaseUrl}/functions/v1/cred-get`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: credential_id }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`cred-get failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`cred-get error: ${result.error}`);
    }

    console.log('DEBUG: Retrieved credentials from cred-get for:', result.email);

    return {
      email: result.email,
      password: result.password,
    };
  } catch (error) {
    throw new Error(`Failed to lookup credentials: ${error.message}`);
  }
}

/**
 * Look up stored credentials by alias (legacy method)
 */
export async function lookupCredentials(
  credentialAlias: string,
  userId: string
): Promise<SkiClubProCredentials> {
  try {
    // Query credentials from Supabase
    const { data: credential, error } = await supabase
      .from('stored_credentials')
      .select('encrypted_data, provider')
      .eq('alias', credentialAlias)
      .eq('user_id', userId)
      .eq('provider', 'skiclubpro')
      .single();

    if (error || !credential) {
      throw new Error(`Credentials not found for alias: ${credentialAlias}`);
    }

    // Decrypt credentials (simplified - in production would use proper encryption)
    const decryptedData = JSON.parse(
      Buffer.from(credential.encrypted_data, 'base64').toString('utf-8')
    );

    return {
      email: decryptedData.email,
      password: decryptedData.password,
    };
  } catch (error) {
    throw new Error(`Failed to lookup credentials: ${error.message}`);
  }
}

/**
 * Store encrypted credentials (for testing/setup)
 */
export async function storeCredentials(
  alias: string,
  provider: string,
  userId: string,
  credentials: SkiClubProCredentials
): Promise<void> {
  try {
    // Encrypt credentials (simplified - in production would use proper encryption)
    const encryptedData = Buffer.from(JSON.stringify(credentials)).toString('base64');

    const { error } = await supabase
      .from('stored_credentials')
      .upsert({
        alias,
        provider,
        user_id: userId,
        encrypted_data: encryptedData,
      });

    if (error) {
      throw new Error(`Failed to store credentials: ${error.message}`);
    }
  } catch (error) {
    throw error;
  }
}