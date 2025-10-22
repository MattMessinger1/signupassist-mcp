#!/usr/bin/env node

/**
 * CLI script to generate OpenAPI specification
 * Usage: npm run openapi:generate
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { generateOpenAPISpec, validateOpenAPISpec } from '../mcp_server/lib/openapi-generator.js';
import { skiClubProTools } from '../mcp_server/providers/skiclubpro.js';

const OUTPUT_PATH = resolve(process.cwd(), 'mcp', 'openapi.json');
const VERSION_FILE = resolve(process.cwd(), 'mcp', '.openapi-version');

interface VersionInfo {
  version: string;
  generatedAt: string;
  toolCount: number;
}

function getNextVersion(breaking: boolean = false): string {
  if (!existsSync(VERSION_FILE)) {
    return '1.0.0';
  }

  try {
    const versionInfo: VersionInfo = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
    const [major, minor, patch] = versionInfo.version.split('.').map(Number);

    if (breaking) {
      return `${major + 1}.0.0`;
    } else {
      return `${major}.${minor}.${patch + 1}`;
    }
  } catch {
    return '1.0.0';
  }
}

function saveVersionInfo(version: string, toolCount: number): void {
  const versionInfo: VersionInfo = {
    version,
    generatedAt: new Date().toISOString(),
    toolCount
  };
  writeFileSync(VERSION_FILE, JSON.stringify(versionInfo, null, 2));
}

function compareSpecs(oldSpec: any, newSpec: any): { changed: boolean; breaking: boolean; changes: string[] } {
  const changes: string[] = [];
  let breaking = false;

  // Check tool count
  const oldToolCount = oldSpec?.paths?.['/tools/call']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.tool?.enum?.length || 0;
  const newToolCount = newSpec?.paths?.['/tools/call']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.tool?.enum?.length || 0;

  if (newToolCount !== oldToolCount) {
    changes.push(`Tool count changed: ${oldToolCount} → ${newToolCount}`);
    if (newToolCount < oldToolCount) {
      breaking = true;
      changes.push('⚠️  BREAKING: Tools removed');
    }
  }

  // Check schema changes
  const oldSchemas = Object.keys(oldSpec?.components?.schemas || {});
  const newSchemas = Object.keys(newSpec?.components?.schemas || {});

  const addedSchemas = newSchemas.filter(s => !oldSchemas.includes(s));
  const removedSchemas = oldSchemas.filter(s => !newSchemas.includes(s));

  if (addedSchemas.length > 0) {
    changes.push(`Added schemas: ${addedSchemas.join(', ')}`);
  }

  if (removedSchemas.length > 0) {
    changes.push(`⚠️  BREAKING: Removed schemas: ${removedSchemas.join(', ')}`);
    breaking = true;
  }

  return {
    changed: changes.length > 0,
    breaking,
    changes
  };
}

async function main() {
  console.log('🔧 Generating OpenAPI specification...\n');

  // Load existing spec if it exists
  let oldSpec: any = null;
  if (existsSync(OUTPUT_PATH)) {
    try {
      oldSpec = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
      console.log(`📄 Found existing spec v${oldSpec.info.version}`);
    } catch (error) {
      console.warn('⚠️  Could not parse existing spec, will create new one');
    }
  }

  // Generate new spec
  const baseUrl = process.env.MCP_SERVER_URL || 'https://signupassist-mcp-production.up.railway.app';
  
  console.log(`📦 Discovered ${skiClubProTools.length} tools`);
  skiClubProTools.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });

  const newSpec = generateOpenAPISpec(skiClubProTools, baseUrl);

  // Validate spec
  console.log('\n✅ Validating OpenAPI spec...');
  const validation = validateOpenAPISpec(newSpec);
  
  if (!validation.valid) {
    console.error('❌ Validation failed:');
    validation.errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }

  // Compare with old spec
  let version = '1.0.0';
  if (oldSpec) {
    const comparison = compareSpecs(oldSpec, newSpec);
    
    if (comparison.changed) {
      console.log('\n📊 Changes detected:');
      comparison.changes.forEach(change => console.log(`  ${change}`));
      
      version = getNextVersion(comparison.breaking);
      console.log(`\n📈 Version: ${oldSpec.info.version} → ${version}`);
    } else {
      console.log('\n✨ No changes detected, keeping version');
      version = oldSpec.info.version;
    }
  } else {
    console.log(`\n🎉 Initial version: ${version}`);
  }

  // Update version in spec
  newSpec.info.version = version;

  // Write spec
  writeFileSync(OUTPUT_PATH, JSON.stringify(newSpec, null, 2));
  console.log(`\n💾 Wrote OpenAPI spec to: ${OUTPUT_PATH}`);

  // Save version info
  saveVersionInfo(version, skiClubProTools.length);
  console.log(`📝 Saved version info to: ${VERSION_FILE}`);

  // Print summary
  console.log('\n📋 Summary:');
  console.log(`  Version: ${version}`);
  console.log(`  Tools: ${skiClubProTools.length}`);
  console.log(`  Server: ${baseUrl}`);
  console.log(`  File: ${OUTPUT_PATH}`);
  
  console.log('\n✅ Done!\n');
  console.log('🔗 Test the spec at:');
  console.log(`   ${baseUrl}/mcp/openapi.json`);
}

main().catch(error => {
  console.error('❌ Error generating OpenAPI spec:', error);
  process.exit(1);
});
