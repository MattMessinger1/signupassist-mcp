// mcp_server/config/providers/skiclubpro/prereqs.ts
import type { Checker, Ctx, Result } from '../../../prereqs/types.js';
import { gotoAny, bodyText } from '../../../prereqs/helpers.js';

// Lightweight heuristics + URL fallbacks + text hints.
// Org-specific overrides can extend these arrays later.
const URLS = {
  dashboard: ['/dashboard', '/user', '/'],
  membership: ['/membership', '/user/membership', '/account/memberships', '/account'],
  payment: ['/user/payment-methods', '/billing', '/payments', '/customer-portal'],
  family: ['/user/family', '/family', '/children', '/household', '/participants']
};

function pass(id: string, label: string, explain: string, blocking: boolean, evidence: any, confidence = 0.9): Result {
  return { id, label, explain, blocking, outcome: 'pass', confidence, evidence };
}
function fail(id: string, label: string, explain: string, blocking: boolean, evidence: any, remediation?: any, confidence = 0.8): Result {
  return { id, label, explain, blocking, outcome: 'fail', confidence, evidence, remediation };
}
function unknown(id: string, label: string, explain: string, blocking: boolean, evidence: any): Result {
  return { id, label, explain, blocking, outcome: 'unknown', confidence: 0.3, evidence };
}

export const SkiClubProCheckers: Checker[] = [
  {
    id: 'account.login',
    label: 'Account Status',
    explain: 'We must be able to sign in to your Blackhawk (SkiClubPro) account.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.dashboard);
      const url = page.url();
      const cookies = await page.context().cookies();
      const hasSess = cookies?.some((c: any) => /S?SESS/i.test(c.name));
      const logoutUi = await page.$('a[href*="/user/logout"], [href*="/logout"], .user-menu, [data-user]');
      const ok = !/\/user\/login/i.test(url) && (!!logoutUi || hasSess);
      const ev = { url, text_excerpt: await bodyText(page, 500) };
      return ok
        ? pass('account.login', 'Account Status', 'We must be able to sign in to your Blackhawk (SkiClubPro) account.', true, ev)
        : fail('account.login', 'Account Status', 'We must be able to sign in to your Blackhawk (SkiClubPro) account.', true, ev, {
            label: 'Open Dashboard', url: `${baseUrl}/dashboard`
          });
    }
  },
  {
    id: 'membership.active',
    label: 'Membership Status',
    explain: 'Many programs require an active Blackhawk membership for the current season.',
    blocking: true,
    appliesTo: () => true, // later: make conditional by programRef if needed
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.membership);
      const url = page.url();
      const text = await bodyText(page, 1200);
      const active = /(active|current)\s+(member|membership)/i.test(text) && !/expired|inactive/i.test(text);
      const ev = { url, text_excerpt: text.slice(0, 300) };
      return active
        ? pass('membership.active', 'Membership Status', 'Active membership detected for this season.', true, ev)
        : fail('membership.active', 'Membership Status', 'Active membership required for most registrations.', true, ev, {
            label: 'Manage Membership', url: `${baseUrl}/membership`
          });
    }
  },
  {
    id: 'payment.method',
    label: 'Payment Method',
    explain: 'A chargeable payment method should be available via Blackhawk\'s billing portal.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.payment);
      const url = page.url();
      const text = await bodyText(page, 1000);
      const portal = /(payment methods|customer portal|update card|card ending|billing)/i.test(text);
      const ev = { url, text_excerpt: text.slice(0, 250) };
      return portal
        ? pass('payment.method', 'Payment Method', 'Payment portal is accessible.', true, ev)
        : fail('payment.method', 'Payment Method', 'Add or update a card in the Blackhawk billing portal.', true, ev, {
            label: 'Open Billing', url: `${baseUrl}/user/payment-methods`
          });
    }
  },
  {
    id: 'child.profile',
    label: 'Child Profile',
    explain: 'You must have at least one child profile in Blackhawk to register them.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.family);

      // Multi-strategy extraction (table rows, cards, lists)
      const rows = page.locator('table tbody tr, .views-row, .family-member, li, .card, .panel');
      const n = await rows.count();
      const children: { name: string }[] = [];
      for (let i = 0; i < Math.min(n, 200); i++) {
        const el = rows.nth(i);
        const text = ((await el.innerText().catch(() => '')) || '').trim();
        if (!text) continue;
        if (!/(child|children|youth|participant|dob|birth|grade|family)/i.test(text)) continue;
        const name = (
          await el.locator('h1,h2,h3,.title,.name,strong,td:first-child').first().innerText().catch(()=>'')
        ) || text.split('\n')[0];
        if (name && name.trim() && name.trim().length < 120) children.push({ name: name.trim() });
      }

      // Fallback: look for an "Add Child/Family Member" button (a sign that no children exist)
      const hasAdd = !!(await page.$('a:has-text("Add Child"), a:has-text("Add Family"), button:has-text("Add Child")'));

      const url = page.url();
      const ev = { url, text_excerpt: await bodyText(page, 300) };
      const ok = children.length > 0;

      return ok
        ? {
            id: 'child.profile', label: 'Child Profile',
            explain: 'You must have at least one child profile in Blackhawk to register them.',
            blocking: true, outcome: 'pass', confidence: 0.85,
            evidence: ev, extra: { children }
          }
        : fail('child.profile', 'Child Profile',
            'Add a child profile to proceed with registration.', true, ev,
            { label: 'Open Family', url: `${baseUrl}/user/family` },
            hasAdd ? 0.95 : 0.8);
    }
  }
];
