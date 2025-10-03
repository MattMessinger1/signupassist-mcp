// mcp_server/prereqs/types.ts
export type Outcome = 'pass' | 'fail' | 'unknown';

export interface Evidence {
  url?: string;
  text_excerpt?: string;
}

export interface Remediation {
  label: string;
  url?: string;
}

export interface Result {
  id: string;
  label: string;
  explain: string;
  blocking: boolean;
  outcome: Outcome;
  confidence: number; // 0..1
  evidence?: Evidence;
  remediation?: Remediation;
  extra?: Record<string, unknown>;
}

export interface Ctx {
  orgRef: string;
  programRef?: string;
  userId?: string;
  page: any;      // Playwright Page
  baseUrl: string;
}

export interface Checker {
  id: string;
  label: string;
  explain: string;
  blocking: boolean;
  appliesTo: (ctx: Ctx) => Promise<boolean> | boolean;
  check: (ctx: Ctx) => Promise<Result>;
}
