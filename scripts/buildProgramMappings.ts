/**
 * Build Program Mappings from Audit Logs
 * 
 * Phase 4: Analyzes successful registrations from mandate_audit table
 * to build high-confidence program mappings for fast-path intent targeting.
 * 
 * Usage:
 *   tsx scripts/buildProgramMappings.ts [--output path/to/output.json] [--min-samples 3]
 * 
 * Output:
 *   - JSON file with program mappings
 *   - Confidence scores based on frequency
 *   - Keywords extracted from program names
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const supabaseUrl = process.env.SUPABASE_URL || process.env.SB_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface AuditRecord {
  id: string;
  user_id: string;
  action: string;
  provider?: string;
  org_ref?: string;
  program_ref?: string;
  metadata?: {
    childAge?: number;
    category?: string;
    program?: { name?: string; title?: string };
    [key: string]: any;
  };
  created_at: string;
}

interface ProgramStats {
  program_ref: string;
  org_ref: string;
  title: string;
  count: number;
  ages: number[];
  categories: string[];
  keywords: string[];
  firstSeen: string;
  lastSeen: string;
}

interface ProgramMapping {
  program_ref: string;
  ageMin: number;
  ageMax: number;
  category: string;
  provider: string;
  keywords: string[];
  confidence: number;
  season?: string;
  samples: number;
}

/**
 * Extract keywords from program title
 */
function extractKeywords(title: string): string[] {
  const stopWords = new Set(['the', 'and', 'or', 'for', 'at', 'on', 'in', 'of', 'a', 'an']);
  
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 5); // Top 5 keywords
}

/**
 * Determine season from program title or dates
 */
function determineSeason(title: string, metadata?: any): string | undefined {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('winter') || titleLower.includes('ski')) return 'winter';
  if (titleLower.includes('summer')) return 'summer';
  if (titleLower.includes('spring')) return 'spring';
  if (titleLower.includes('fall') || titleLower.includes('autumn')) return 'fall';
  
  // Could also extract from dates in metadata
  return undefined;
}

/**
 * Calculate confidence score based on frequency and data quality
 */
function calculateConfidence(stats: ProgramStats, totalSamples: number): number {
  // Base confidence from frequency (normalized 0-1)
  const frequencyScore = Math.min(stats.count / totalSamples, 1.0);
  
  // Bonus for having age data
  const hasAgeData = stats.ages.length > 0 ? 0.1 : 0;
  
  // Bonus for having category data
  const hasCategoryData = stats.categories.length > 0 ? 0.1 : 0;
  
  // Bonus for recent activity (within last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const isRecent = new Date(stats.lastSeen) > sixMonthsAgo ? 0.1 : 0;
  
  // Calculate weighted score
  const confidence = Math.min(
    frequencyScore * 0.6 + hasAgeData + hasCategoryData + isRecent,
    1.0
  );
  
  return Math.round(confidence * 100) / 100; // Round to 2 decimals
}

/**
 * Main script execution
 */
async function buildProgramMappings() {
  console.log('🔍 Querying mandate_audit for successful registrations...\n');
  
  // Get command line arguments
  const args = process.argv.slice(2);
  const outputPathArg = args.find(arg => arg.startsWith('--output='));
  const minSamplesArg = args.find(arg => arg.startsWith('--min-samples='));
  
  const outputPath = outputPathArg 
    ? outputPathArg.split('=')[1] 
    : resolve(process.cwd(), 'mcp_server/config/program_mappings.json');
  
  const minSamples = minSamplesArg 
    ? parseInt(minSamplesArg.split('=')[1]) 
    : 3;
  
  try {
    // Query all successful registrations
    const { data: auditRecords, error } = await supabase
      .from('mandate_audit')
      .select('*')
      .eq('action', 'registration_completed')
      .not('program_ref', 'is', null)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Failed to query audit logs:', error);
      process.exit(1);
    }
    
    if (!auditRecords || auditRecords.length === 0) {
      console.log('⚠️  No successful registrations found in audit logs');
      console.log('   Run some test registrations first or use mock data');
      process.exit(0);
    }
    
    console.log(`✅ Found ${auditRecords.length} successful registrations\n`);
    
    // Group by program_ref and build statistics
    const programStats = new Map<string, ProgramStats>();
    
    for (const record of auditRecords as AuditRecord[]) {
      const key = `${record.org_ref}:${record.program_ref}`;
      
      if (!programStats.has(key)) {
        programStats.set(key, {
          program_ref: record.program_ref!,
          org_ref: record.org_ref || 'unknown',
          title: record.metadata?.program?.name || record.metadata?.program?.title || `Program ${record.program_ref}`,
          count: 0,
          ages: [],
          categories: [],
          keywords: [],
          firstSeen: record.created_at,
          lastSeen: record.created_at
        });
      }
      
      const stats = programStats.get(key)!;
      stats.count++;
      
      // Collect age data
      if (record.metadata?.childAge) {
        stats.ages.push(record.metadata.childAge);
      }
      
      // Collect category data
      if (record.metadata?.category && !stats.categories.includes(record.metadata.category)) {
        stats.categories.push(record.metadata.category);
      }
      
      // Update date range
      if (record.created_at < stats.firstSeen) {
        stats.firstSeen = record.created_at;
      }
      if (record.created_at > stats.lastSeen) {
        stats.lastSeen = record.created_at;
      }
    }
    
    console.log(`📊 Analyzed ${programStats.size} unique programs\n`);
    
    // Build mappings with confidence scores
    const mappings: ProgramMapping[] = [];
    const totalRegistrations = auditRecords.length;
    
    for (const [key, stats] of programStats.entries()) {
      // Skip programs with insufficient samples
      if (stats.count < minSamples) {
        console.log(`⏭️  Skipping ${stats.program_ref} (only ${stats.count} samples)`);
        continue;
      }
      
      // Calculate age range
      const ageMin = stats.ages.length > 0 ? Math.min(...stats.ages) : 4;
      const ageMax = stats.ages.length > 0 ? Math.max(...stats.ages) : 18;
      
      // Determine primary category
      const category = stats.categories.length > 0 
        ? stats.categories[0] 
        : 'lessons'; // Default fallback
      
      // Extract keywords
      const keywords = extractKeywords(stats.title);
      
      // Calculate confidence
      const confidence = calculateConfidence(stats, totalRegistrations);
      
      // Determine season
      const season = determineSeason(stats.title, {});
      
      const mapping: ProgramMapping = {
        program_ref: stats.program_ref,
        ageMin,
        ageMax,
        category,
        provider: stats.org_ref,
        keywords,
        confidence,
        samples: stats.count
      };
      
      if (season) {
        mapping.season = season;
      }
      
      mappings.push(mapping);
      
      console.log(`✅ ${stats.org_ref}/${stats.program_ref}: confidence=${confidence} (${stats.count} samples)`);
    }
    
    // Sort by confidence (highest first)
    mappings.sort((a, b) => b.confidence - a.confidence);
    
    console.log(`\n📝 Generated ${mappings.length} program mappings\n`);
    
    // Write to JSON file
    const output = {
      generated_at: new Date().toISOString(),
      total_samples: totalRegistrations,
      mappings_count: mappings.length,
      min_samples: minSamples,
      mappings
    };
    
    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    
    console.log(`✅ Wrote program mappings to: ${outputPath}\n`);
    
    // Print summary statistics
    console.log('📊 Summary:');
    console.log(`   Total registrations: ${totalRegistrations}`);
    console.log(`   Unique programs: ${programStats.size}`);
    console.log(`   High-confidence programs (≥0.8): ${mappings.filter(m => m.confidence >= 0.8).length}`);
    console.log(`   Medium-confidence programs (0.5-0.8): ${mappings.filter(m => m.confidence >= 0.5 && m.confidence < 0.8).length}`);
    console.log(`   Low-confidence programs (<0.5): ${mappings.filter(m => m.confidence < 0.5).length}`);
    
  } catch (error: any) {
    console.error('❌ Error building program mappings:', error.message);
    process.exit(1);
  }
}

// Run the script
buildProgramMappings()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
