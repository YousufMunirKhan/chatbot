/**
 * Dashboard navigation, as a data file.
 *
 * WHY THIS IS NOT IN THE LAYOUT
 * -----------------------------
 * `src/app/(dashboard)/layout.tsx` is the one file every dashboard change has to
 * touch, so it is the file two people always collide in. The nav is pure data —
 * hrefs and labels, no session, no I/O — so it lives here and the layout imports
 * it. Adding a page is now a one-line edit in a file nobody else is editing.
 *
 * HOW THE GROUPING WAS CHOSEN
 * ---------------------------
 * The audience is a shop owner, not a developer, and often not a native English
 * speaker. So the group headings name a JOB ("Talk to customers", "Sell more"),
 * not a module ("Messaging", "Commerce"), and the item labels are the words the
 * owner would use out loud. Six jobs, in the order a new account meets them:
 *
 *   1. Start here          — what do I do first
 *   2. Talk to customers   — the daily work
 *   3. Teach your assistant— what it knows and how it behaves
 *   4. Where customers find you — the places a chat can start
 *   5. Sell more           — the money-making extras
 *   6. How it's going      — numbers
 *   7. Your account        — team, bill, everything else
 *
 * RULES FOR ADDING TO THIS FILE
 * -----------------------------
 * - One destination, one entry. A page that is already reachable as a tab or a
 *   "Manage all" link on another page does NOT get a second sidebar row —
 *   /company/leads, /company/orders and /company/appointments are all rolled up
 *   under Customers on purpose.
 * - Two words where possible. The sidebar is 224px inside its padding and every
 *   label also has to survive translation into Arabic, which runs longer.
 * - Nothing that only a developer would search for goes in the sidebar. The
 *   /company/settings hub is where webhooks, the API and the connectors live.
 *
 * TRANSLATION
 * -----------
 * Item labels are translated by href (`navKey('/company/inbox')` →
 * `nav.company.inbox`), group headings by the group's `key`
 * (`nav.group.conversations`). Both fall back to the English written here when
 * the dictionary has no entry, so a new route is never a blank sidebar row.
 */

export interface NavItemDef {
  href: string;
  label: string;
}

export interface NavGroupDef {
  /** Stable slug for the `nav.group.<key>` dictionary lookup. */
  key: string;
  /** English heading, and the fallback when the dictionary has no entry. */
  group: string;
  items: NavItemDef[];
}

/** Platform operator navigation. Unchanged — this audience is internal. */
export const PLATFORM_NAV_GROUPS: NavGroupDef[] = [
  {
    key: 'platform',
    group: 'Platform',
    items: [
      { href: '/super-admin', label: 'Command Center' },
      { href: '/super-admin/companies', label: 'Companies' },
      { href: '/super-admin/agencies', label: 'Agencies' },
      { href: '/super-admin/billing', label: 'Billing & Plans' },
      { href: '/super-admin/quality', label: 'Quality & Usage' },
      { href: '/super-admin/subscriptions', label: 'Subscriptions' },
      { href: '/super-admin/usage', label: 'Usage' },
      { href: '/super-admin/costs', label: 'AI Cost' },
      { href: '/super-admin/profit', label: 'Profit / Loss' },
      { href: '/super-admin/chat-logs', label: 'Chat Logs' },
      { href: '/super-admin/integrations', label: 'Integrations' },
      { href: '/super-admin/notifications', label: 'Notifications' },
      { href: '/super-admin/audit-logs', label: 'Audit Logs' },
      { href: '/super-admin/security', label: 'Security Logs' },
      { href: '/super-admin/error-logs', label: 'Error Logs' },
      { href: '/super-admin/settings', label: 'Settings' },
    ],
  },
];

/**
 * An agent works one queue and looks people up. Anything that configures the
 * product is deliberately absent — this is the reduced nav, and it stays reduced.
 */
export const AGENT_NAV_GROUPS: NavGroupDef[] = [
  {
    key: 'workspace',
    group: 'Workspace',
    items: [
      { href: '/company/inbox', label: 'Inbox' },
      { href: '/company/customers', label: 'Customers' },
    ],
  },
];

/**
 * Company-admin navigation.
 *
 * Conditional rows (the staff help desk, the agency console) are added by
 * `companyNavGroups()` rather than being listed here, so this constant stays a
 * plain description of the product.
 */
const COMPANY_NAV_GROUPS: NavGroupDef[] = [
  {
    key: 'start',
    group: 'Start here',
    items: [
      { href: '/company', label: 'Home' },
      // Was "Setup". A verb tells the owner it is something to do, not a place.
      { href: '/company/setup', label: 'Get set up' },
    ],
  },
  {
    key: 'conversations',
    group: 'Talk to customers',
    items: [
      { href: '/company/inbox', label: 'Inbox' },
      // Rolls up leads, appointment requests and orders; those three pages are
      // reached from here rather than getting sidebar rows of their own.
      { href: '/company/customers', label: 'Customers' },
      // Was "Notifications" — three syllables shorter and the same meaning.
      { href: '/company/notifications', label: 'Alerts' },
    ],
  },
  {
    key: 'assistant',
    group: 'Teach your assistant',
    items: [
      { href: '/company/bots', label: 'My assistants' },
      // Was "Business Data" — an owner does not think of their opening hours as
      // data. This is the single most-visited configuration page, so its label
      // matters more than any other. Uploaded files are its "Knowledge" tab, so
      // /company/knowledge (a redirect into that tab) gets no row of its own.
      { href: '/company/business-data', label: 'My business info' },
      // Was "Quick Actions" — nothing in that name says it puts buttons in chat.
      { href: '/company/quick-actions', label: 'Chat buttons' },
      // Was "Flows". A flow is a diagram to us and nothing to an owner; what
      // they get is a conversation that runs the same way every time.
      { href: '/company/flows', label: 'Guided chats' },
      // Reads the company's own conversations and drafts a guided chat for
      // the question people keep asking. Sits under Guided chats because
      // accepting one creates a draft flow you then edit in the builder.
      { href: '/company/flows/suggestions', label: 'Suggested chats' },
      // Was "Intents & NLU". Two pieces of jargon in one label.
      { href: '/company/intents', label: 'Trigger phrases' },
      // Was "Quality" / "Quality Room". Says what you do there instead.
      { href: '/company/quality', label: 'Improve answers' },
      { href: '/company/help-center', label: 'Help articles' },
    ],
  },
  {
    key: 'reach',
    group: 'Where customers find you',
    items: [
      // Was "Website Widget". "Widget" is our word, not theirs.
      { href: '/company/widget', label: 'Website chat' },
      // Was "Channels", which in a shop means a TV channel or a sales channel.
      { href: '/company/channels', label: 'Messaging apps' },
      { href: '/company/whatsapp', label: 'WhatsApp' },
    ],
  },
  {
    key: 'sell',
    group: 'Sell more',
    items: [
      // Was "Catalog" — "Products" is what is actually in it.
      { href: '/company/catalog', label: 'Products' },
      // Was "Store automations".
      { href: '/company/automations', label: 'Automatic messages' },
      // Was "Broadcasts" — a broadcast is radio; this is one message to many.
      { href: '/company/broadcasts', label: 'Bulk messages' },
      // Was "Proactive campaigns".
      { href: '/company/campaigns', label: 'Chat invites' },
    ],
  },
  {
    key: 'results',
    group: "How it's going",
    items: [
      { href: '/company/reports', label: 'Reports' },
      { href: '/company/usage', label: 'Usage & limits' },
      { href: '/company/activity', label: 'Activity log' },
    ],
  },
  {
    key: 'account',
    group: 'Your account',
    items: [
      { href: '/company/agents', label: 'Team' },
      { href: '/company/billing', label: 'Billing' },
      // The hub. Everything an owner touches once a year — privacy, security,
      // response targets, connected apps, webhooks, the API — is behind here.
      { href: '/company/settings', label: 'All settings' },
    ],
  },
];

export interface CompanyNavOptions {
  /** The tenant runs an assistant for its own staff (help-desk bot or connector). */
  showInternalHelpDesk?: boolean;
  /** This operator owns a reseller agency (migration 0057). */
  showAgency?: boolean;
}

/**
 * The company sidebar for one tenant.
 *
 * Returns fresh objects every call so a caller can never mutate the constant,
 * and so the two conditional rows land inside the right group instead of being
 * appended to the bottom of the whole list the way the old flat array did it.
 */
export function companyNavGroups(options: CompanyNavOptions = {}): NavGroupDef[] {
  return COMPANY_NAV_GROUPS.map((group) => {
    if (group.key === 'conversations' && options.showInternalHelpDesk) {
      return {
        ...group,
        // Was "Internal Help Desk". It belongs beside the customer inbox because
        // it is the same job — answering someone — for a different audience.
        items: [...group.items, { href: '/company/help-desk', label: 'Staff help desk' }],
      };
    }
    if (group.key === 'account' && options.showAgency) {
      return { ...group, items: [...group.items, { href: '/company/agency', label: 'Agency' }] };
    }
    return { ...group, items: [...group.items] };
  });
}

/** Fallback sidebar for a session with no company resolved yet. */
export const COMPANY_NAV_FALLBACK: NavGroupDef[] = companyNavGroups();
