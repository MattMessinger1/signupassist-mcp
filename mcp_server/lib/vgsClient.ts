/**
 * VGS (Very Good Security) Proxy Client
 * Handles tokenization and detokenization of PII through VGS vault
 */

export interface VGSConfig {
  enabled: boolean;
  vaultId: string;
  proxyHost: string;
  username: string;
  password: string;
}

export interface TokenizeRequest {
  email?: string;
  phone?: string;
}

export interface TokenizeResponse {
  email_alias?: string;
  phone_alias?: string;
}

export interface DetokenizeRequest {
  email_alias?: string;
  phone_alias?: string;
}

export interface DetokenizeResponse {
  email?: string;
  phone?: string;
}

/**
 * Get VGS configuration from environment
 */
export function getVGSConfig(): VGSConfig {
  return {
    enabled: process.env.VGS_PROXY_ENABLED === 'true',
    vaultId: process.env.VGS_VAULT_ID || '',
    proxyHost: process.env.VGS_PROXY_HOST || '',
    username: process.env.VGS_USERNAME || '',
    password: process.env.VGS_PASSWORD || '',
  };
}

/**
 * Check if VGS is properly configured
 */
export function isVGSConfigured(): boolean {
  const config = getVGSConfig();
  return config.enabled && !!config.vaultId && !!config.proxyHost;
}

/**
 * Tokenize PII data through VGS proxy
 * Returns aliases that can be safely stored in database
 */
export async function tokenize(data: TokenizeRequest): Promise<TokenizeResponse> {
  const config = getVGSConfig();
  
  // If VGS is disabled, return passthrough (for development/testing)
  if (!config.enabled) {
    console.warn('[VGS] Tokenization disabled - returning passthrough values');
    return {
      email_alias: data.email ? `passthrough:${Buffer.from(data.email).toString('base64')}` : undefined,
      phone_alias: data.phone ? `passthrough:${Buffer.from(data.phone).toString('base64')}` : undefined,
    };
  }

  if (!config.vaultId || !config.proxyHost) {
    throw new Error('[VGS] Missing required configuration: VGS_VAULT_ID or VGS_PROXY_HOST');
  }

  try {
    const response = await fetch(`${config.proxyHost}/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      },
      body: JSON.stringify({
        data: [
          ...(data.email ? [{ value: data.email, format: 'UUID', storage: 'PERSISTENT' }] : []),
          ...(data.phone ? [{ value: data.phone, format: 'UUID', storage: 'PERSISTENT' }] : []),
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VGS tokenization failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Map VGS response to our format
    const aliases: TokenizeResponse = {};
    if (data.email && result.data?.[0]) {
      aliases.email_alias = result.data[0].aliases?.[0]?.alias || result.data[0].value;
    }
    if (data.phone) {
      const phoneIndex = data.email ? 1 : 0;
      if (result.data?.[phoneIndex]) {
        aliases.phone_alias = result.data[phoneIndex].aliases?.[0]?.alias || result.data[phoneIndex].value;
      }
    }

    return aliases;
  } catch (error) {
    console.error('[VGS] Tokenization error:', error);
    throw error;
  }
}

/**
 * Detokenize aliases back to original PII
 * Only call this when PII needs to be displayed or sent to external service
 */
export async function detokenize(aliases: DetokenizeRequest): Promise<DetokenizeResponse> {
  const config = getVGSConfig();
  
  // If VGS is disabled, decode passthrough values
  if (!config.enabled) {
    console.warn('[VGS] Detokenization disabled - decoding passthrough values');
    return {
      email: aliases.email_alias?.startsWith('passthrough:') 
        ? Buffer.from(aliases.email_alias.replace('passthrough:', ''), 'base64').toString('utf-8')
        : aliases.email_alias,
      phone: aliases.phone_alias?.startsWith('passthrough:') 
        ? Buffer.from(aliases.phone_alias.replace('passthrough:', ''), 'base64').toString('utf-8')
        : aliases.phone_alias,
    };
  }

  if (!config.vaultId || !config.proxyHost) {
    throw new Error('[VGS] Missing required configuration: VGS_VAULT_ID or VGS_PROXY_HOST');
  }

  try {
    const aliasesToReveal = [
      ...(aliases.email_alias ? [aliases.email_alias] : []),
      ...(aliases.phone_alias ? [aliases.phone_alias] : []),
    ];

    if (aliasesToReveal.length === 0) {
      return {};
    }

    const response = await fetch(`${config.proxyHost}/aliases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      },
      body: JSON.stringify({
        aliases: aliasesToReveal,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VGS detokenization failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Map VGS response to our format
    const revealed: DetokenizeResponse = {};
    if (aliases.email_alias && result.data?.[0]) {
      revealed.email = result.data[0].value;
    }
    if (aliases.phone_alias) {
      const phoneIndex = aliases.email_alias ? 1 : 0;
      if (result.data?.[phoneIndex]) {
        revealed.phone = result.data[phoneIndex].value;
      }
    }

    return revealed;
  } catch (error) {
    console.error('[VGS] Detokenization error:', error);
    throw error;
  }
}

/**
 * Utility to check if a value is a VGS alias (tok_xxx format)
 */
export function isVGSAlias(value: string): boolean {
  return value.startsWith('tok_') || value.startsWith('passthrough:');
}

/**
 * Safely get display value - returns masked version for aliases
 */
export function getMaskedValue(value: string, type: 'email' | 'phone'): string {
  if (isVGSAlias(value)) {
    return type === 'email' ? '***@***.***' : '***-***-****';
  }
  
  // Mask actual values for display
  if (type === 'email') {
    const [local, domain] = value.split('@');
    if (local && domain) {
      return `${local.charAt(0)}***@${domain}`;
    }
  }
  
  if (type === 'phone') {
    return value.replace(/\d(?=\d{4})/g, '*');
  }
  
  return '***';
}
