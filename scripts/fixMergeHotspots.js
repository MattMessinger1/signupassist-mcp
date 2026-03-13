#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const targetFile = fileArg
  ? fileArg.slice('--file='.length)
  : path.join(process.cwd(), 'mcp_server', 'index.ts');

const shouldWrite = process.argv.includes('--write');

function findBlockEnd(lines, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
    }
    if (i > startIndex && depth === 0) return i;
  }
  return -1;
}

function dedupeAdjacentIfBlocks(lines, ifHeader) {
  let removed = 0;
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].includes(ifHeader)) {
      i += 1;
      continue;
    }

    const end1 = findBlockEnd(lines, i);
    if (end1 === -1) break;

    let j = end1 + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;

    if (j >= lines.length || !lines[j].includes(ifHeader)) {
      i = end1 + 1;
      continue;
    }

    const end2 = findBlockEnd(lines, j);
    if (end2 === -1) break;

    const block1 = lines.slice(i, end1 + 1).join('\n');
    const block2 = lines.slice(j, end2 + 1).join('\n');

    if (block1 === block2) {
      lines.splice(end1 + 1, end2 - end1);
      removed += 1;
      i = Math.max(0, i - 3);
      continue;
    }

    i = end1 + 1;
  }

  return removed;
}

const original = readFileSync(targetFile, 'utf8');
const lines = original.split('\n');

let removedTotal = 0;
removedTotal += dedupeAdjacentIfBlocks(lines, 'if (hasJsonBody && !bodyLengthLooksSafe) {');
removedTotal += dedupeAdjacentIfBlocks(lines, 'if (hasJsonBody && bodyLengthHeaderPresentButInvalid) {');

const updated = lines.join('\n');

if (removedTotal === 0) {
  console.log(`✅ No duplicate merge hotspots found in ${targetFile}`);
  process.exit(0);
}

if (!shouldWrite) {
  console.error(`❌ Found ${removedTotal} duplicate merge hotspot block(s) in ${targetFile}`);
  console.error('Run with --write to auto-fix:');
  console.error('  node scripts/fixMergeHotspots.js --write');
  process.exit(1);
}

writeFileSync(targetFile, updated, 'utf8');
console.log(`✅ Removed ${removedTotal} duplicate merge hotspot block(s) in ${targetFile}`);
