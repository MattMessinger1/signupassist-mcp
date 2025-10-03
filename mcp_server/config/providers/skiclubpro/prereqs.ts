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
    explain: 'Many programs require an active membership for the current season.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.membership);
      const url = page.url();
      const text = await bodyText(page, 1500);
      
      // Strong positive indicators
      const activeIndicators = [
        /(active|current|valid)\s+(member|membership)/i,
        /membership\s+(status|type):\s*(active|current)/i,
        /season\s+\d{4}.*?(active|current)/i,
        /renew(ed|al)?\s+for\s+\d{4}/i
      ];
      
      // Strong negative indicators
      const inactiveIndicators = [
        /(expired|inactive|lapsed)\s+(member|membership)/i,
        /membership\s+(expired|inactive)/i,
        /renew\s+your\s+membership/i,
        /purchase.*membership/i,
        /no\s+(active|current)\s+membership/i
      ];
      
      const hasActive = activeIndicators.some(rx => rx.test(text));
      const hasInactive = inactiveIndicators.some(rx => rx.test(text));
      
      const ev = { url, text_excerpt: text.slice(0, 300) };
      
      if (hasActive && !hasInactive) {
        return pass('membership.active', 'Membership Status', 'Active membership detected for this season.', true, ev, 0.9);
      }
      
      if (hasInactive || /join\s+now|become\s+a\s+member/i.test(text)) {
        return fail('membership.active', 'Membership Status', 'Active membership required for most registrations.', true, ev, {
          label: 'Manage Membership', url: `${baseUrl}/membership`
        }, 0.85);
      }
      
      // Ambiguous - can't determine clearly
      return unknown('membership.active', 'Membership Status', 
        'Unable to confirm membership status automatically. Please verify on the membership page.', true, ev);
    }
  },
  {
    id: 'payment.method',
    label: 'Payment Method',
    explain: 'A chargeable payment method should be available for registration fees.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.payment);
      const url = page.url();
      const text = await bodyText(page, 1200);
      
      // Positive indicators - card exists
      const hasCard = [
        /card\s+ending\s+(in\s+)?\d{4}/i,
        /\*{4,}\s*\d{4}/i,
        /visa|mastercard|amex|discover.*\d{4}/i,
        /saved\s+card/i,
        /default\s+(card|payment\s+method)/i
      ].some(rx => rx.test(text));
      
      // Negative indicators - no card
      const noCard = [
        /no\s+payment\s+method/i,
        /add\s+(a\s+)?payment\s+method/i,
        /no\s+saved\s+cards?/i,
        /please\s+add.*card/i
      ].some(rx => rx.test(text));
      
      const ev = { url, text_excerpt: text.slice(0, 300) };
      
      if (hasCard) {
        return pass('payment.method', 'Payment Method', 'Payment method on file detected.', true, ev, 0.9);
      }
      
      if (noCard) {
        return fail('payment.method', 'Payment Method', 'Add a payment method in the billing portal.', true, ev, {
          label: 'Add Payment Method', url: `${baseUrl}/user/payment-methods`
        }, 0.85);
      }
      
      // Can access portal but unclear if card exists
      if (/(payment methods?|billing|customer portal)/i.test(text)) {
        return unknown('payment.method', 'Payment Method',
          'Payment portal accessible but unable to confirm saved payment method. Please verify manually.', true, ev);
      }
      
      // Can't even find payment portal
      return unknown('payment.method', 'Payment Method',
        'Unable to locate payment settings. Please check billing portal manually.', true, ev);
    }
  },
  {
    id: 'child.profile',
    label: 'Child Profile',
    explain: 'You must have at least one child profile to register them.',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;
      await gotoAny(page, baseUrl, URLS.family);

      const url = page.url();
      const bodyContent = await bodyText(page, 1500);
      
      // Strong negative indicators - definitely no children
      const noChildIndicators = [
        /no\s+(child|participant|family\s+member)s?\s+(found|added)/i,
        /add\s+your\s+first\s+(child|participant)/i,
        /you\s+don'?t\s+have\s+any\s+(child|participant)/i
      ];
      
      const clearlyEmpty = noChildIndicators.some(rx => rx.test(bodyContent));
      
      // Multi-strategy extraction with better patterns
      const selectors = [
        'table tbody tr',
        '.views-row',
        '.family-member',
        '.participant',
        '.child-profile',
        '[data-child]',
        '.household-member',
        'ul.children li',
        '.card.child',
        '.panel-child'
      ];
      
      const rows = page.locator(selectors.join(', '));
      const n = await rows.count();
      const children: { name: string }[] = [];
      
      for (let i = 0; i < Math.min(n, 200); i++) {
        const el = rows.nth(i);
        const text = ((await el.innerText().catch(() => '')) || '').trim();
        if (!text || text.length < 2) continue;
        
        // Skip navigation, headers, footers
        if (/(navigation|menu|header|footer|logout|account)/i.test(text)) continue;
        
        // Must have child-relevant keywords
        const relevantPatterns = [
          /(child|youth|participant|student|kid)/i,
          /\b(dob|birth|age|grade)\b/i,
          /\d{1,2}\/\d{1,2}\/\d{2,4}/,  // date pattern
          /\b(son|daughter)\b/i
        ];
        
        if (!relevantPatterns.some(rx => rx.test(text))) continue;
        
        // Extract name - try multiple strategies
        let name = await el.locator('h1,h2,h3,h4,.title,.name,.child-name,strong,b,td:first-child,[data-name]')
          .first().innerText().catch(() => '');
        
        if (!name) {
          // Fallback: first line of text
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          name = lines[0] || '';
        }
        
        name = name.trim();
        
        // Validate name
        if (name && name.length >= 2 && name.length < 100) {
          // Skip common non-name patterns
          if (!/^(add|edit|delete|remove|view|details|actions?|home|dashboard)/i.test(name)) {
            children.push({ name });
          }
        }
      }
      
      // Deduplicate by name
      const uniqueChildren = Array.from(new Map(children.map(c => [c.name, c])).values());
      
      // Check for "Add" button as secondary indicator
      const addButtons = await page.$$('a:has-text("Add Child"), a:has-text("Add Family Member"), a:has-text("Add Participant"), button:has-text("Add Child"), button:has-text("Add Participant")');
      const hasAddButton = addButtons.length > 0;
      
      const ev = { url, text_excerpt: bodyContent.slice(0, 400) };
      
      if (uniqueChildren.length > 0) {
        return {
          id: 'child.profile', 
          label: 'Child Profile',
          explain: `Found ${uniqueChildren.length} child profile${uniqueChildren.length > 1 ? 's' : ''}.`,
          blocking: true, 
          outcome: 'pass', 
          confidence: 0.85,
          evidence: ev, 
          extra: { children: uniqueChildren }
        };
      }
      
      if (clearlyEmpty || (hasAddButton && uniqueChildren.length === 0)) {
        return fail('child.profile', 'Child Profile',
          'Add a child profile to proceed with registration.', true, ev,
          { label: 'Add Child Profile', url: `${baseUrl}/user/family` },
          0.9);
      }
      
      // Uncertain - couldn't find children but also no clear "empty" state
      return unknown('child.profile', 'Child Profile',
        'Unable to detect child profiles automatically. Please verify on the family page.', true, ev);
    }
  },
  {
    id: 'waiver.signed',
    label: 'Required Waivers',
    explain: 'Many clubs require you to sign a seasonal waiver (sometimes bundled in membership).',
    blocking: true,
    appliesTo: () => true,
    check: async (ctx: Ctx) => {
      const { page, baseUrl } = ctx;

      // Try common waiver pages first
      await gotoAny(page, baseUrl, ['/waiver', '/waivers', '/account/waivers', '/user/waivers']);
      const url = page.url();
      const text = await bodyText(page, 1200);

      const signed = /waiver signed|waiver on file|accepted waiver/i.test(text);
      const pending = /please sign|waiver required|sign waiver/i.test(text);

      const ev = { url, text_excerpt: text.slice(0, 300) };

      if (signed) {
        return {
          id: 'waiver.signed',
          label: 'Required Waivers',
          explain: 'Waiver appears to be signed already.',
          blocking: true,
          outcome: 'pass',
          confidence: 0.9,
          evidence: ev,
          extra: { source: 'standalone' }
        };
      }

      if (pending) {
        return {
          id: 'waiver.signed',
          label: 'Required Waivers',
          explain: 'Waiver signature is required before registration.',
          blocking: true,
          outcome: 'fail',
          confidence: 0.9,
          evidence: ev,
          remediation: { label: 'Sign Waiver', url: `${baseUrl}/waivers` }
        };
      }

      // fallback: check membership page for waiver hints
      await gotoAny(page, baseUrl, ['/membership', '/account']);
      const mtext = await bodyText(page, 1200);
      if (/waiver accepted/i.test(mtext) || /waiver completed/i.test(mtext)) {
        return {
          id: 'waiver.signed',
          label: 'Required Waivers',
          explain: 'Waiver appears satisfied as part of membership.',
          blocking: true,
          outcome: 'pass',
          confidence: 0.7,
          evidence: { url: page.url(), text_excerpt: mtext.slice(0, 200) },
          extra: { source: 'membership-bundle' }
        };
      }

      return {
        id: 'waiver.signed',
        label: 'Required Waivers',
        explain: 'Could not confirm waiver status automatically. It may be bundled in membership or program checkout.',
        blocking: true,
        outcome: 'unknown',
        confidence: 0.3,
        evidence: ev
      };
    }
  }
];
