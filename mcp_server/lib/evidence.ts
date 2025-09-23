/**
 * Evidence Capture and Storage
 * Handles screenshots and other evidence for audit trail
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

// Initialize Supabase client for backend operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface EvidenceCapture {
  asset_url: string;
  sha256: string;
}

/**
 * Upload evidence to storage and log to database
 */
export async function captureEvidence(
  planExecutionId: string,
  evidenceType: string,
  data: Buffer,
  filename?: string
): Promise<EvidenceCapture> {
  try {
    // Generate filename if not provided
    const finalFilename = filename || `${evidenceType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`;
    
    // Calculate SHA256 hash
    const sha256 = createHash('sha256').update(data).digest('hex');
    
    // For now, simulate evidence storage (in production would upload to Supabase Storage)
    const assetUrl = `https://evidence.signupassist.com/${planExecutionId}/${finalFilename}`;
    
    // Log evidence to database
    const { error } = await supabase
      .from('evidence_assets')
      .insert({
        plan_execution_id: planExecutionId,
        type: evidenceType,
        url: assetUrl,
        sha256,
        ts: new Date().toISOString(),
      });

    if (error) {
      throw new Error(`Failed to log evidence: ${error.message}`);
    }

    return {
      asset_url: assetUrl,
      sha256,
    };

  } catch (error) {
    throw new Error(`Failed to capture evidence: ${error.message}`);
  }
}

/**
 * Capture and store screenshot evidence
 */
export async function captureScreenshotEvidence(
  planExecutionId: string,
  screenshot: Buffer,
  description?: string
): Promise<EvidenceCapture> {
  const filename = `screenshot-${description || 'capture'}-${Date.now()}.png`;
  return captureEvidence(planExecutionId, 'screenshot', screenshot, filename);
}

/**
 * Capture and store page source evidence
 */
export async function capturePageSourceEvidence(
  planExecutionId: string,
  pageSource: string,
  description?: string
): Promise<EvidenceCapture> {
  const filename = `page-source-${description || 'capture'}-${Date.now()}.html`;
  const data = Buffer.from(pageSource, 'utf-8');
  return captureEvidence(planExecutionId, 'page_source', data, filename);
}