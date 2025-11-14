/**
 * AAP System Cleanup - Phase 4
 * 
 * ⚠️ WARNING: Only run this script after:
 * 1. USE_NEW_AAP=true has been enabled in production
 * 2. System has been monitored for 1-2 weeks with no issues
 * 3. All test cases pass consistently
 * 
 * This script will:
 * 1. Remove the USE_NEW_AAP feature flag
 * 2. Delete deprecated AAP files
 * 3. Clean up legacy code references
 * 
 * Run with: tsx scripts/aapCleanupPhase4.ts --confirm
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIRM_FLAG = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM_FLAG;

console.log('🧹 AAP System Cleanup - Phase 4\n');
console.log('=' .repeat(60));

if (DRY_RUN) {
  console.log('⚠️  DRY RUN MODE - No files will be modified');
  console.log('   Run with --confirm to apply changes');
  console.log('=' .repeat(60) + '\n');
} else {
  console.log('⚠️  PRODUCTION MODE - Files will be modified!');
  console.log('=' .repeat(60) + '\n');
  
  // Safety check
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  await new Promise<void>((resolve) => {
    readline.question('Have you monitored production for 1-2 weeks with no AAP issues? (yes/no): ', (answer: string) => {
      if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cleanup aborted. Monitor production first!');
        process.exit(0);
      }
      readline.close();
      resolve();
    });
  });
}

// ============================================================================
// Step 1: Remove Feature Flag from AIOrchestrator
// ============================================================================

console.log('\n📝 Step 1: Remove USE_NEW_AAP Feature Flag');
console.log('-'.repeat(60));

const orchestratorPath = 'mcp_server/ai/AIOrchestrator.ts';
let orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

// Remove feature flag constant
const flagRegex = /\/\*\*\s*\*\ Feature Flag\.\*\/\s*const USE_NEW_AAP_SYSTEM = .*?;\s*/s;
const hasFlag = flagRegex.test(orchestratorContent);

if (hasFlag) {
  console.log('✅ Found USE_NEW_AAP_SYSTEM flag');
  
  if (!DRY_RUN) {
    orchestratorContent = orchestratorContent.replace(flagRegex, '');
    
    // Remove the if/else branch, keep only NEW AAP code
    const ifElseRegex = /if \(USE_NEW_AAP_SYSTEM\) \{([\s\S]*?)\} else \{[\s\S]*?\/\/ OLD SYSTEM[\s\S]*?\}/s;
    orchestratorContent = orchestratorContent.replace(ifElseRegex, (match, newAAPCode) => {
      // Extract just the NEW AAP code block content
      return newAAPCode.trim();
    });
    
    writeFileSync(orchestratorPath, orchestratorContent);
    console.log('✅ Removed feature flag and legacy code branch');
  } else {
    console.log('   Would remove feature flag and keep only new AAP code');
  }
} else {
  console.log('⚠️  Feature flag already removed or not found');
}

// ============================================================================
// Step 2: Delete Deprecated Files
// ============================================================================

console.log('\n🗑️  Step 2: Delete Deprecated Files');
console.log('-'.repeat(60));

const filesToDelete = [
  'mcp_server/ai/preLoginNarrowing.ts'
];

for (const file of filesToDelete) {
  if (existsSync(file)) {
    console.log(`✅ Found ${file}`);
    if (!DRY_RUN) {
      unlinkSync(file);
      console.log(`   Deleted ${file}`);
    } else {
      console.log(`   Would delete ${file}`);
    }
  } else {
    console.log(`⚠️  File not found: ${file}`);
  }
}

// ============================================================================
// Step 3: Remove Deprecated Functions from aiIntentParser
// ============================================================================

console.log('\n📝 Step 3: Clean Up aiIntentParser.ts');
console.log('-'.repeat(60));

const aiIntentParserPath = 'mcp_server/lib/aiIntentParser.ts';
let aiIntentContent = readFileSync(aiIntentParserPath, 'utf-8');

// Remove parseIntentWithAI function and its supporting code
const parseIntentRegex = /\/\*\*\s*\* @deprecated[\s\S]*?\*\/\s*export async function parseIntentWithAI[\s\S]*?^}/m;
const hasParseIntent = parseIntentRegex.test(aiIntentContent);

if (hasParseIntent) {
  console.log('✅ Found deprecated parseIntentWithAI function');
  
  if (!DRY_RUN) {
    // Remove the function
    aiIntentContent = aiIntentContent.replace(parseIntentRegex, '');
    
    // Remove related interfaces if they're only used by parseIntentWithAI
    // Keep normalizeEmailWithAI and generatePersonalizedMessage
    
    // Update deprecation notice in header
    aiIntentContent = aiIntentContent.replace(
      /@deprecated.*parseIntentWithAI is being replaced.*\n.*New code should use.*\n.*Email normalization and message generation.*\n.*\n.*To enable the new system.*\n/,
      '/**\n * AI Intent Parser\n * \n * Provides email normalization and personalized message generation.\n * For AAP extraction, use mcp_server/ai/aapTriageTool.ts\n */\n'
    );
    
    writeFileSync(aiIntentParserPath, aiIntentContent);
    console.log('✅ Removed parseIntentWithAI and updated documentation');
  } else {
    console.log('   Would remove parseIntentWithAI function');
  }
} else {
  console.log('⚠️  parseIntentWithAI already removed or not found');
}

// ============================================================================
// Step 4: Remove Legacy Imports
// ============================================================================

console.log('\n📝 Step 4: Remove Legacy Imports from AIOrchestrator');
console.log('-'.repeat(60));

orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

const legacyImports = [
  /import \{ parseAAPTriad, buildAAPQuestion, buildNaturalAAPQuestion, buildCacheQuery, mapIntentToAAP \} from ["']\.\/preLoginNarrowing\.js["']?;\s*/,
  /import \{ parseIntentWithAI \} from ["']\.\.\/lib\/aiIntentParser\.js["']?;\s*/
];

let importsRemoved = 0;
for (const importRegex of legacyImports) {
  if (importRegex.test(orchestratorContent)) {
    console.log(`✅ Found legacy import`);
    if (!DRY_RUN) {
      orchestratorContent = orchestratorContent.replace(importRegex, '');
      importsRemoved++;
    } else {
      console.log('   Would remove import');
    }
  }
}

if (!DRY_RUN && importsRemoved > 0) {
  writeFileSync(orchestratorPath, orchestratorContent);
  console.log(`✅ Removed ${importsRemoved} legacy imports`);
}

// ============================================================================
// Step 5: Update Documentation
// ============================================================================

console.log('\n📝 Step 5: Update Documentation');
console.log('-'.repeat(60));

const docPath = 'docs/AAP_FEATURE_FLAG.md';
let docContent = readFileSync(docPath, 'utf-8');

if (!DRY_RUN) {
  // Archive old feature flag section
  docContent = docContent.replace(
    '# AAP System Feature Flag',
    '# AAP System - New Implementation (Phase 4 Complete)'
  );
  
  docContent = docContent.replace(
    /## Feature Flag[\s\S]*?## Systems/,
    `## Migration Complete

The AAP system migration is complete. The new structured AAP triad system is now the only implementation.

**Completed**: ${new Date().toISOString().split('T')[0]}

## System

### Current Implementation
- **Files**: \`mcp_server/ai/aapTriageTool.ts\`, \`mcp_server/ai/aapDiscoveryPlanner.ts\`
- **Mechanism**: OpenAI function calling with structured JSON
- **State**: Structured \`AAPTriad\` with status/source tracking
- **Features**:
  - ✅ Loop prevention via \`asked_flags\`
  - ✅ Context preservation (never loses provider/activity/age)
  - ✅ Audit trail (tracks source: explicit/implicit/profile/assumed)
  - ✅ Discovery planning (generates feed queries)
  - ✅ Graceful "not sure" handling

### Removed (Legacy)
- **Files**: ~~\`mcp_server/ai/preLoginNarrowing.ts\`~~, ~~\`parseIntentWithAI\` from \`mcp_server/lib/aiIntentParser.ts\`~~
- **Status**: Deleted in Phase 4 cleanup

## Systems`
  );
  
  // Remove rollback section since there's no more flag
  docContent = docContent.replace(/## Rollback[\s\S]*?(?=## |$)/, '');
  
  writeFileSync(docPath, docContent);
  console.log('✅ Updated documentation to reflect Phase 4 completion');
} else {
  console.log('   Would update documentation');
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('📊 Cleanup Summary');
console.log('='.repeat(60));

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN - No changes made');
  console.log('\nWould perform:');
  console.log('  ✓ Remove USE_NEW_AAP feature flag');
  console.log('  ✓ Delete preLoginNarrowing.ts');
  console.log('  ✓ Remove parseIntentWithAI from aiIntentParser.ts');
  console.log('  ✓ Clean up legacy imports');
  console.log('  ✓ Update documentation');
  console.log('\nTo apply changes, run: tsx scripts/aapCleanupPhase4.ts --confirm');
} else {
  console.log('\n✅ Phase 4 Cleanup Complete!');
  console.log('\nChanges applied:');
  console.log('  ✓ Removed USE_NEW_AAP feature flag');
  console.log('  ✓ Deleted deprecated files');
  console.log('  ✓ Removed legacy code and imports');
  console.log('  ✓ Updated documentation');
  console.log('\n⚠️  Next steps:');
  console.log('  1. Test the application thoroughly');
  console.log('  2. Run: npm run build:check');
  console.log('  3. Deploy to production');
  console.log('  4. Monitor logs for any issues');
}

console.log('\n' + '='.repeat(60));
