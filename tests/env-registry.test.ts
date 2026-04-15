import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENV_DEFINITIONS,
  getEnvDefinitionsForTarget,
  getMissingEnvForTarget,
  renderDotenvTemplate,
} from "../scripts/envRegistry";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const envExample = readFileSync(".env.example", "utf8");
const envDocs = readFileSync("docs/ENVIRONMENT.md", "utf8");

describe("env registry", () => {
  it("keeps env var names unique and shell-safe", () => {
    const names = ENV_DEFINITIONS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("keeps env commands discoverable from package.json", () => {
    expect(packageJson.scripts["env:check"]).toBe("tsx scripts/envDoctor.ts check");
    expect(packageJson.scripts["env:list"]).toBe("tsx scripts/envDoctor.ts list");
    expect(packageJson.scripts["env:example"]).toBe("tsx scripts/envDoctor.ts example");
    expect(packageJson.scripts["env:write"]).toBe("tsx scripts/envDoctor.ts write");
  });

  it("models the core production targets", () => {
    const railwayWebRequired = getEnvDefinitionsForTarget("railway-web")
      .filter((definition) => definition.requirement === "required")
      .map((definition) => definition.name);
    const railwayWorkerRequired = getEnvDefinitionsForTarget("railway-worker")
      .filter((definition) => definition.requirement === "required")
      .map((definition) => definition.name);
    const supabaseRequired = getEnvDefinitionsForTarget("supabase-functions")
      .filter((definition) => definition.requirement === "required")
      .map((definition) => definition.name);

    expect(railwayWebRequired).toEqual(
      expect.arrayContaining([
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "BOOKEO_API_KEY",
        "BOOKEO_SECRET_KEY",
        "MCP_ACCESS_TOKEN",
        "AUTH0_DOMAIN",
        "AUTH0_CLIENT_ID",
        "AUTH0_CLIENT_SECRET",
        "AUTH0_AUDIENCE",
        "OPENAI_API_KEY",
      ]),
    );
    expect(railwayWorkerRequired).toEqual(
      expect.arrayContaining(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BOOKEO_API_KEY", "BOOKEO_SECRET_KEY"]),
    );
    expect(supabaseRequired).toEqual(
      expect.arrayContaining([
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]),
    );
  });

  it("supports aliases when checking configured env values", () => {
    const missing = getMissingEnvForTarget("local", {
      SB_URL: "https://example.supabase.co",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      SB_SERVICE_ROLE_KEY: "service-role",
    });

    expect(missing.map((definition) => definition.name)).not.toContain("SUPABASE_URL");
    expect(missing.map((definition) => definition.name)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("renders target dotenv files without printing missing secret values", () => {
    const output = renderDotenvTemplate({
      target: "railway-worker",
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      includeValues: true,
      includeMissingComments: true,
    });

    expect(output).toContain("SUPABASE_URL=https://example.supabase.co");
    expect(output).toContain("SUPABASE_SERVICE_ROLE_KEY=service-role");
    expect(output).toContain("# MISSING BOOKEO_API_KEY=");
    expect(output).not.toContain("your-bookeo-api-key");
  });

  it("keeps the checked-in template and workflow docs connected to the registry", () => {
    expect(envExample).toBe(renderDotenvTemplate());

    for (const definition of ENV_DEFINITIONS.filter((item) => item.includeInExample !== false)) {
      expect(envExample).toContain(`${definition.name}=`);
    }

    expect(envExample).toContain("Source of truth: scripts/envRegistry.ts");
    expect(envDocs).toContain("npm run env:write -- --target=railway-web");
    expect(envDocs).toContain("supabase secrets set --env-file .env.supabase.generated");
  });
});
