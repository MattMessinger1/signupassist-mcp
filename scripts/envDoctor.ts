#!/usr/bin/env tsx
import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  ENV_TARGET_LABELS,
  type EnvTarget,
  getEnvDefinitionsForTarget,
  getEnvStatusForTarget,
  getMissingEnvForTarget,
  maskEnvValue,
  renderDotenvTemplate,
  renderEnvTable,
} from "./envRegistry";

const VALID_TARGETS = Object.keys(ENV_TARGET_LABELS) as EnvTarget[];

function usage(): never {
  console.log(`SignupAssist env doctor

Commands:
  check      Check required/recommended vars for a target without printing secrets
  list       List vars for a target
  example    Print the full .env.example template from the registry
  write      Write a target-specific dotenv file from your current environment

Examples:
  npm run env:check -- --target=local
  npm run env:check -- --target=railway-web --strict
  npm run env:list -- --target=supabase-functions --include-optional
  npm run env:write -- --target=railway-web --out=.env.railway-web.generated
  npm run env:write -- --target=supabase-functions --out=.env.supabase.generated

Targets:
  ${VALID_TARGETS.join(", ")}
`);
  process.exit(1);
}

function readFlag(name: string, args: string[]): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function hasFlag(name: string, args: string[]): boolean {
  return args.includes(`--${name}`);
}

function readTarget(args: string[], fallback: EnvTarget = "local"): EnvTarget {
  const raw = readFlag("target", args) || fallback;
  if (!VALID_TARGETS.includes(raw as EnvTarget)) {
    throw new Error(`Unknown env target '${raw}'. Valid targets: ${VALID_TARGETS.join(", ")}`);
  }
  return raw as EnvTarget;
}

function commandCheck(args: string[]) {
  const target = readTarget(args);
  const strict = hasFlag("strict", args);
  const includeRecommended = hasFlag("include-recommended", args);
  const statuses = getEnvStatusForTarget(target, process.env, { includeOptional: hasFlag("include-optional", args) });
  const missingRequired = getMissingEnvForTarget(target, process.env);
  const missingRecommended = statuses.filter((status) => status.missing && status.requirement === "recommended");
  const blockingMissing = includeRecommended ? [...missingRequired, ...missingRecommended] : missingRequired;

  console.log(`[env] Target: ${ENV_TARGET_LABELS[target]} (${target})`);
  console.log(`[env] Mode: ${strict ? "strict" : "advisory"}; secrets are masked\n`);

  for (const status of statuses) {
    const prefix = status.missing ? (status.requirement === "required" ? "[missing]" : "[warn]") : "[ok]";
    const configuredVia = status.configuredName && status.configuredName !== status.name ? ` via ${status.configuredName}` : "";
    const value = status.missing ? "" : ` = ${status.secret ? maskEnvValue(status.configuredValue) : status.configuredValue}`;
    console.log(`${prefix} ${status.name}${configuredVia}${value}`);
  }

  console.log("");
  console.log(
    `[env] ${statuses.length - missingRequired.length - missingRecommended.length} configured, ${missingRequired.length} required missing, ${missingRecommended.length} recommended missing`,
  );

  if (strict && blockingMissing.length) {
    process.exit(1);
  }
}

function commandList(args: string[]) {
  const target = readTarget(args);
  process.stdout.write(renderEnvTable(target, { includeOptional: hasFlag("include-optional", args) }));
}

function commandExample() {
  process.stdout.write(renderDotenvTemplate());
}

function commandWrite(args: string[]) {
  const target = readTarget(args);
  const out = readFlag("out", args);
  if (!out) throw new Error("Missing --out=.env.some-target.generated");

  const content = renderDotenvTemplate({
    target,
    env: process.env,
    includeOptional: hasFlag("include-optional", args),
    includeValues: true,
    includeMissingComments: true,
  });
  writeFileSync(out, content);

  const vars = getEnvDefinitionsForTarget(target, { includeOptional: hasFlag("include-optional", args) });
  const missing = getMissingEnvForTarget(target, process.env, { includeRecommended: true });
  console.log(`[env] Wrote ${vars.length} ${ENV_TARGET_LABELS[target]} vars to ${out}`);
  console.log("[env] The file is ignored by git because .env.* is ignored.");
  if (missing.length) {
    console.log(`[env] ${missing.length} required/recommended vars were missing and are commented in the file.`);
  }
}

function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  if (hasFlag("help", args) || command === "help") usage();

  switch (command) {
    case "check":
      commandCheck(args);
      return;
    case "list":
      commandList(args);
      return;
    case "example":
      commandExample();
      return;
    case "write":
      commandWrite(args);
      return;
    default:
      usage();
  }
}

try {
  main();
} catch (error) {
  console.error("[env] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
