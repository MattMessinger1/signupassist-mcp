#!/usr/bin/env tsx
/**
 * Infra check for the agreed SignupAssist platform posture.
 *
 * This script is intentionally non-destructive. By default, missing production
 * env vars are warnings so Codex/local machines can run it without secrets.
 * Set INFRA_CHECK_STRICT=1 to fail on missing env vars in CI or pre-deploy.
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ENV_TARGET_LABELS, type EnvTarget, getMissingEnvForTarget } from "./envRegistry";

type Check = {
  name: string;
  ok: boolean;
  details?: string;
  warning?: boolean;
};

const strict = ["1", "true", "yes"].includes(String(process.env.INFRA_CHECK_STRICT || "").toLowerCase());
const checks: Check[] = [];

function add(name: string, ok: boolean, details?: string, warning = false) {
  checks.push({ name, ok, details, warning });
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function countFiles(path: string) {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isFile()).length;
}

const packageJson = readJson("package.json");
const scripts = packageJson.scripts || {};
const dependencies = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
};
const dockerfile = existsSync("Dockerfile") ? readFileSync("Dockerfile", "utf8") : "";

const requiredFiles = [
  "Dockerfile",
  "railway.json",
  "supabase/config.toml",
  "src/integrations/supabase/client.ts",
  "mcp_server/index.ts",
  "mcp_server/worker/scheduledRegistrationWorker.ts",
  "docs/SCHEDULED_REGISTRATION_WORKER_RUNBOOK.md",
  "docs/INFRA_RUNBOOK.md",
];

for (const file of requiredFiles) {
  add(`Required infra file exists: ${file}`, existsSync(file));
}

const requiredScripts = [
  "mcp:build",
  "build",
  "test",
  "worker:scheduled",
  "v1:preflight",
  "infra:check",
  "infra:smoke:railway",
  "infra:smoke:supabase",
  "infra:smoke:stripe",
];

for (const scriptName of requiredScripts) {
  add(`package.json script exists: ${scriptName}`, typeof scripts[scriptName] === "string");
}

add("Supabase JS dependency is present", Boolean(dependencies["@supabase/supabase-js"]));
add("Railway Dockerfile is present", existsSync("Dockerfile"));
add("Railway Docker build copies PostCSS config for Tailwind", dockerfile.includes("COPY postcss.config.js"));
add("Frontend build compiles Vite assets", String(scripts.build || "").includes("vite build"));
add("Supabase migrations directory has migrations", countFiles("supabase/migrations") > 0);
add("Supabase Edge Functions directory has functions", countFiles("supabase/functions") > 0);

const disallowedNewStackDeps = ["@clerk/nextjs", "@clerk/clerk-react", "@neondatabase/serverless", "convex"];
for (const dep of disallowedNewStackDeps) {
  add(`No new migration dependency: ${dep}`, !dependencies[dep]);
}

try {
  const railway = readJson("railway.json");
  add("Railway healthcheck path is /health", railway?.deploy?.healthcheckPath === "/health");
} catch (error) {
  add("railway.json is valid JSON", false, error instanceof Error ? error.message : String(error));
}

const envGroups: Array<{ name: string; target: EnvTarget }> = [
  { name: ENV_TARGET_LABELS["railway-web"], target: "railway-web" },
  { name: ENV_TARGET_LABELS["railway-worker"], target: "railway-worker" },
  { name: ENV_TARGET_LABELS.frontend, target: "frontend" },
  { name: ENV_TARGET_LABELS["supabase-functions"], target: "supabase-functions" },
];

for (const group of envGroups) {
  const missing = getMissingEnvForTarget(group.target).map((definition) => definition.name);
  add(
    `Env group configured: ${group.name}`,
    missing.length === 0,
    missing.length ? `Missing: ${missing.join(", ")}` : undefined,
    !strict,
  );
}

const failed = checks.filter((check) => !check.ok && !check.warning);
const warnings = checks.filter((check) => !check.ok && check.warning);

for (const check of checks) {
  const prefix = check.ok ? "[ok]" : check.warning ? "[warn]" : "[fail]";
  console.log(`${prefix} ${check.name}${check.details ? ` - ${check.details}` : ""}`);
}

console.log("");
console.log(`Infra check complete: ${checks.length - failed.length - warnings.length} ok, ${warnings.length} warnings, ${failed.length} failures`);

if (failed.length) {
  process.exit(1);
}
