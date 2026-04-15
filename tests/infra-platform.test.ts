import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const railwayJson = JSON.parse(readFileSync("railway.json", "utf8"));
const infraRunbook = readFileSync("docs/INFRA_RUNBOOK.md", "utf8").toLowerCase();
const workerRunbook = readFileSync("docs/SCHEDULED_REGISTRATION_WORKER_RUNBOOK.md", "utf8").toLowerCase();

describe("Supabase + Railway infra posture", () => {
  it("documents Supabase and Railway as the V1 platform defaults", () => {
    expect(infraRunbook).toContain("stays on **supabase + railway**");
    expect(infraRunbook).toContain("do not migrate to vercel, neon, clerk, convex");
    expect(infraRunbook).toContain("migrations are the only schema-change path");
    expect(workerRunbook).toContain("always-on railway worker");
  });

  it("keeps infra and smoke scripts discoverable from package.json", () => {
    expect(packageJson.scripts["infra:check"]).toBe("tsx scripts/infraCheck.ts");
    expect(packageJson.scripts["infra:smoke:railway"]).toBe("tsx scripts/smokeRailway.ts");
    expect(packageJson.scripts["infra:smoke:supabase"]).toBe("tsx scripts/smokeSupabase.ts");
    expect(packageJson.scripts["infra:smoke:stripe"]).toBe("tsx scripts/smokeStripe.ts");
    expect(packageJson.scripts["predeploy:check"]).toContain("npm run infra:check");
  });

  it("has smoke script entrypoints on disk", () => {
    expect(existsSync("scripts/infraCheck.ts")).toBe(true);
    expect(existsSync("scripts/smokeRailway.ts")).toBe(true);
    expect(existsSync("scripts/smokeSupabase.ts")).toBe(true);
    expect(existsSync("scripts/smokeStripe.ts")).toBe(true);
  });

  it("keeps Railway health checks pointed at /health", () => {
    expect(railwayJson.deploy.healthcheckPath).toBe("/health");
  });

  it("does not introduce replacement auth or database dependencies", () => {
    const allDeps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    expect(allDeps["@supabase/supabase-js"]).toBeTruthy();
    expect(allDeps["@clerk/nextjs"]).toBeUndefined();
    expect(allDeps["@clerk/clerk-react"]).toBeUndefined();
    expect(allDeps["@neondatabase/serverless"]).toBeUndefined();
    expect(allDeps.convex).toBeUndefined();
  });
});
