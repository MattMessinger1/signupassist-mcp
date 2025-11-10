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
 * Decrypt credentials using CRED_SEAL_KEY (AES-GCM)
 * Uses Web Crypto API to match Supabase edge function encryption
 */
async function decryptCredentials(encryptedData: string): Promise<SkiClubProCredentials> {
  const sealKey = process.env.CRED_SEAL_KEY;
  if (!sealKey) {
    throw new Error('CRED_SEAL_KEY not configured');
  }

  try {
    // Split encrypted data and IV (format: encryptedBase64:ivBase64)
    const [encryptedBase64, ivBase64] = encryptedData.split(':');
    
    // Convert base64 back to binary
    const encryptedBytes = Buffer.from(encryptedBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const keyData = Buffer.from(sealKey, 'base64');
    
    // Import the key using Web Crypto API (matches edge function)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    // Decrypt using Web Crypto API (auth tag is embedded in encrypted data)
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encryptedBytes
    );
    
    // Convert ArrayBuffer to string and parse JSON
    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    const credentials = JSON.parse(decryptedText);
    
    return {
      email: credentials.email,
      password: credentials.password,
    };
  } catch (error) {
    throw new Error(`Failed to decrypt credentials: ${error.message}`);
  }
}

/**
 * Look up credentials by ID using Supabase cred-get edge function
 * For service credentials (system user), bypasses JWT and decrypts directly
 * For regular user credentials, uses cred-get edge function with JWT
 */
export async function lookupCredentialsById(
  credential_id: string,
  userJwt?: string
): Promise<SkiClubProCredentials> {
  try {
    // STEP 1: Check if this is a service credential (owned by system user)
    const SYSTEM_USER_ID = 'eb8616ca-a2fa-4849-aef6-723528d8c273';
    
    const { data: credInfo, error: credError } = await supabase
      .from('stored_credentials')
      .select('user_id, encrypted_data')
      .eq('id', credential_id)
      .single();
    
    if (credError || !credInfo) {
      throw new Error(`Credential not found: ${credential_id}`);
    }
    
    const isServiceCredential = credInfo.user_id === SYSTEM_USER_ID;
    
    // STEP 2: For service credentials, bypass JWT and decrypt directly
    if (isServiceCredential) {
      console.log('[lookupCredentialsById] Using service credential, bypassing JWT');
      return await decryptCredentials(credInfo.encrypted_data);
    }
    
    // STEP 3: For regular user credentials, require JWT and use cred-get edge function
    if (!userJwt) {
      throw new Error('User JWT is required for credential lookup');
    }

    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userJwt}`,
      'apikey': supabaseAnonKey,
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