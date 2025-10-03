// mcp_server/prereqs/registry.ts
import type { Checker, Ctx, Result } from './types';

const registries: Record<string, Checker[]> = {}; // provider -> checkers

export function registerProvider(provider: string, checkers: Checker[]) {
  registries[provider] = checkers;
}

export async function runChecks(provider: string, ctx: Ctx): Promise<Result[]> {
  const set = registries[provider] || [];
  const results: Result[] = [];
  for (const c of set) {
    try {
      const applies = await c.appliesTo(ctx);
      if (!applies) continue;
      const r = await c.check(ctx);
      results.push(r);
    } catch (e: any) {
      results.push({
        id: c.id, label: c.label, explain: c.explain, blocking: c.blocking,
        outcome: 'unknown', confidence: 0,
        evidence: { url: ctx.page?.url?.() },
        remediation: undefined, extra: { error: e?.message || String(e) }
      });
    }
  }
  return results;
}
