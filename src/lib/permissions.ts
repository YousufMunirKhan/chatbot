import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { ROLES, type Role } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ForbiddenError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * What one person on a team is allowed to do (migration 0080).
 *
 * `public.permissions` and `public.company_users.permissions_json` have both
 * existed since migration 0002 and neither had a single reader — the product
 * shipped for 78 migrations with two roles and a column of empty JSON. This is
 * the reader.
 *
 * THE MODEL, IN ONE SENTENCE
 * --------------------------
 * A role carries a default set of permissions, and `permissions_json` holds only
 * the DIFFERENCES from it: `{"reports.view": true, "leads.export": false}`.
 *
 * Storing the differences rather than the whole set is what makes this migration
 * safe to run on live data. Every membership row in the table today holds `{}`,
 * `{}` resolves to exactly the role's defaults, and the role defaults below were
 * read off what each role could already reach — so an existing member's access
 * is bit-for-bit what it was yesterday. It also keeps the role meaningful after
 * the fact: move somebody from team member to owner and their baseline moves
 * with them, instead of them carrying a frozen snapshot of the old role around.
 *
 * The same shape and the same "unknown keys are dropped" rule as
 * `subscriptions.feature_overrides` in `src/lib/entitlements.ts`, deliberately —
 * one override idiom in this codebase, not two.
 *
 * SERVER ONLY
 * -----------
 * This module reads the session and the service-role client, so it can never be
 * imported by a `'use client'` component. Client forms take the labels and
 * groups below as plain props from the server component that renders them, or
 * import the types with `import type`, which TypeScript erases.
 */

/* -------------------------------------------------------------------------
 * The permission set
 *
 * One key per area the product actually has. The list was read off the
 * dashboard sidebar (`src/components/dashboard-nav-items.ts`), not invented:
 * every row an owner can see in that sidebar falls under exactly one key here,
 * so "what can this person do" and "what will this person see" cannot describe
 * two different products.
 *
 * The ten keys seeded in migration 0002 are all kept, spelled exactly as they
 * were. A key is a stored value — renaming one silently revokes access for
 * everyone who had an override on it.
 * ---------------------------------------------------------------------- */
export const PERMISSIONS = [
  'inbox.view',
  'inbox.reply',
  'customers.view',
  'leads.view',
  'leads.export',
  'orders.view',
  'appointments.view',
  'helpdesk.view',
  'bots.manage',
  'quality.manage',
  'channels.manage',
  'catalog.manage',
  'campaigns.manage',
  'reports.view',
  'notifications.manage',
  'agents.manage',
  'billing.manage',
  'integrations.manage',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS);

/** A `permissions_json` value once it has been read and cleaned up. */
export type PermissionOverrides = Partial<Record<Permission, boolean>>;

/**
 * Owner-facing names. Same words as the sidebar wherever a permission maps onto
 * a sidebar row, because someone ticking "Products" has to be able to find the
 * page it turns on.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'inbox.view': 'See the inbox',
  'inbox.reply': 'Reply to customers',
  'customers.view': 'See customers',
  'leads.view': 'See enquiries',
  'leads.export': 'Download enquiries',
  'orders.view': 'See orders',
  'appointments.view': 'See bookings',
  'helpdesk.view': 'Use the staff help desk',
  'bots.manage': 'Teach the assistant',
  'quality.manage': 'Improve answers',
  'channels.manage': 'Set up where customers find you',
  'catalog.manage': 'Manage products',
  'campaigns.manage': 'Send messages out',
  'reports.view': 'See reports',
  'notifications.manage': 'Decide who gets alerted',
  'agents.manage': 'Manage the team',
  'billing.manage': 'Manage billing',
  'integrations.manage': 'Connect other apps',
  'settings.manage': 'Change company settings',
};

/** One plain sentence each, shown under the tick box on the Team page. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'inbox.view': 'Open the inbox and read conversations.',
  'inbox.reply': 'Write replies and step into a chat the assistant cannot finish.',
  'customers.view': 'Look someone up and read their history with you.',
  'leads.view': 'Read the details customers leave in chat.',
  'leads.export': 'Take a copy of every enquiry out of the product as a spreadsheet.',
  'orders.view': 'Read orders and order enquiries.',
  'appointments.view': 'Read booking requests and change their status.',
  'helpdesk.view': 'Ask the internal assistant questions about how your business works.',
  'bots.manage': 'Change your assistants, your business info, chat buttons, guided chats and trigger phrases.',
  'quality.manage': 'Review what the assistant answered and correct it.',
  'channels.manage': 'Set up website chat, messaging apps and WhatsApp.',
  'catalog.manage': 'Add and edit the products the assistant can talk about.',
  'campaigns.manage': 'Send automatic messages, bulk messages and chat invites to customers.',
  'reports.view': 'See how the assistant is doing and how much of the plan is used.',
  'notifications.manage': 'Choose which alerts go to whom, and how they are delivered.',
  'agents.manage': 'Invite people, change what they can do, and remove them.',
  'billing.manage': 'See and change the plan, the card on file and the credit balance.',
  'integrations.manage': 'Connect your shop, calendar and other systems.',
  'settings.manage': 'Company settings, data retention, security and the developer tools.',
};

export interface PermissionGroup {
  key: string;
  /** Heading, matching the sidebar group these permissions belong to. */
  group: string;
  permissions: readonly Permission[];
}

/**
 * The permissions in the order and grouping of the sidebar, so the tick list on
 * the Team page reads as a tour of the product rather than an alphabetised dump
 * of internal keys.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: 'conversations',
    group: 'Talk to customers',
    permissions: [
      'inbox.view',
      'inbox.reply',
      'customers.view',
      'leads.view',
      'leads.export',
      'orders.view',
      'appointments.view',
      'helpdesk.view',
    ],
  },
  {
    key: 'assistant',
    group: 'Teach your assistant',
    permissions: ['bots.manage', 'quality.manage'],
  },
  {
    key: 'reach',
    group: 'Where customers find you',
    permissions: ['channels.manage'],
  },
  {
    key: 'sell',
    group: 'Sell more',
    permissions: ['catalog.manage', 'campaigns.manage'],
  },
  {
    key: 'results',
    group: "How it's going",
    permissions: ['reports.view'],
  },
  {
    key: 'account',
    group: 'Your account',
    permissions: [
      'notifications.manage',
      'agents.manage',
      'billing.manage',
      'integrations.manage',
      'settings.manage',
    ],
  },
];

/* -------------------------------------------------------------------------
 * Role defaults
 * ---------------------------------------------------------------------- */

/**
 * What a team member can do with no overrides at all.
 *
 * This list is not a design; it is a transcription. It is every page and action
 * that admits `ROLES.AGENT` today — the inbox and its canned replies, customers,
 * enquiries, orders, bookings and the staff help desk. Nothing was added because
 * it seemed reasonable and nothing was dropped because it seemed generous: a
 * default that differs from today's behaviour would quietly change what every
 * existing agent in production can do the moment this ships.
 *
 * `leads.export` is deliberately absent — `src/app/api/company/leads/export`
 * has always been `requireRole([ROLES.COMPANY_ADMIN])`, so granting it here
 * would be handing every agent on the platform the customer list.
 */
const AGENT_DEFAULTS: readonly Permission[] = [
  'inbox.view',
  'inbox.reply',
  'customers.view',
  'leads.view',
  'orders.view',
  'appointments.view',
  'helpdesk.view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [ROLES.SUPER_ADMIN]: PERMISSIONS,
  [ROLES.COMPANY_ADMIN]: PERMISSIONS,
  [ROLES.AGENT]: AGENT_DEFAULTS,
};

/**
 * The roles one company may hand out.
 *
 * `super_admin` is absent on purpose. It is a platform flag on
 * `public.users.is_super_admin`, not a membership, and an invite form that could
 * offer it would let any tenant admin grant themselves the platform. Migration
 * 0080's check constraint refuses it at the database as well.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = [ROLES.COMPANY_ADMIN, ROLES.AGENT];

/**
 * How much authority a role carries, for the "you cannot hand out more than you
 * hold" rule. Higher wins; a role outside the ladder ranks at zero.
 */
const ROLE_RANK: Record<string, number> = {
  [ROLES.SUPER_ADMIN]: 3,
  [ROLES.COMPANY_ADMIN]: 2,
  [ROLES.AGENT]: 1,
};

export function roleRank(role: Role | string | null | undefined): number {
  return role ? (ROLE_RANK[role] ?? 0) : 0;
}

/** Is `role` a company role somebody may actually be assigned? */
export function isAssignableRole(value: unknown): value is Role {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------- */

/**
 * Read whatever is in the JSON column into a shape the resolver trusts.
 *
 * The column is hand-editable and predates every key in this file, so it can
 * hold a permission we retired, a misspelling, or the string `"true"`. Anything
 * that is not a boolean under a known key is dropped, which means the worst a
 * bad value can do is leave the role's own answer standing — the direction that
 * cannot silently take access away from somebody who has it today.
 */
export function normalizePermissionOverrides(value: unknown): PermissionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const overrides: PermissionOverrides = {};
  for (const key of Object.keys(raw)) {
    if (!PERMISSION_KEYS.has(key)) continue;
    const entry = raw[key];
    if (typeof entry === 'boolean') overrides[key as Permission] = entry;
  }
  return overrides;
}

/**
 * Role defaults, then the overrides on top. The one place the two are combined.
 *
 * A null role — a signed-in user with no membership in this company — resolves
 * to nothing rather than to a default set. There is no "member of no role", and
 * inventing one here is how a permission system ends up granting on a bug.
 */
export function resolvePermissions(
  role: Role | string | null | undefined,
  overrides: unknown,
): Set<Permission> {
  const defaults = role ? (ROLE_PERMISSIONS[role as Role] ?? []) : [];
  const effective = new Set<Permission>(defaults);
  const patch = normalizePermissionOverrides(overrides);
  for (const key of PERMISSIONS) {
    const override = patch[key];
    if (override === true) effective.add(key);
    else if (override === false) effective.delete(key);
  }
  return effective;
}

/**
 * The overrides needed to turn `role`'s defaults into `wanted` — the inverse of
 * `resolvePermissions`, and what a form full of tick boxes has to be saved as.
 *
 * Only genuine differences are recorded, so an admin who leaves the defaults
 * alone stores `{}` and the member keeps following their role. Writing all
 * nineteen answers out every time would work and would be wrong: it freezes a
 * copy of today's role definition onto the row, and a later change to what a
 * team member can do would reach everybody except the people an admin had once
 * opened this form for.
 */
export function overridesFrom(role: Role, wanted: Iterable<Permission>): PermissionOverrides {
  const defaults = new Set(ROLE_PERMISSIONS[role] ?? []);
  const target = new Set(wanted);
  const overrides: PermissionOverrides = {};
  for (const key of PERMISSIONS) {
    const isDefault = defaults.has(key);
    const isWanted = target.has(key);
    if (isDefault !== isWanted) overrides[key] = isWanted;
  }
  return overrides;
}

/** Keep only the values that are real permission keys. */
export function parsePermissionList(values: readonly unknown[]): Permission[] {
  const seen = new Set<Permission>();
  for (const value of values) {
    if (typeof value === 'string' && PERMISSION_KEYS.has(value)) seen.add(value as Permission);
  }
  return PERMISSIONS.filter((key) => seen.has(key));
}

/**
 * Everything in `wanted` that `held` does not cover.
 *
 * This is the whole escalation rule in one function: an admin may hand out any
 * subset of what they themselves hold, and nothing else. An empty result means
 * the grant is allowed.
 */
export function permissionsBeyond(
  held: ReadonlySet<Permission>,
  wanted: Iterable<Permission>,
): Permission[] {
  const excess: Permission[] = [];
  for (const key of wanted) if (!held.has(key)) excess.push(key);
  return excess;
}

/** "See reports and Manage billing" — for a refusal message a person can act on. */
export function describePermissions(keys: readonly Permission[]): string {
  const labels = keys.map((key) => PERMISSION_LABELS[key]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/* -------------------------------------------------------------------------
 * The signed-in person's own permissions
 * ---------------------------------------------------------------------- */

/**
 * The overrides on one membership row, read once per request.
 *
 * `cache()` is React's per-request memo, the same mechanism `getSessionUser()`
 * uses in `src/lib/auth/index.ts` and `loadEntitlementSource()` uses in
 * `src/lib/entitlements.ts`. It earns its place for the same reason it does
 * there: a page that asks four permission questions in four components would
 * otherwise pay four identical round trips for one row that cannot change
 * mid-render.
 *
 * A failed read resolves to no overrides, so the person keeps their role's
 * defaults. That is the only safe direction: a blip in the database must not
 * read as "your access was revoked" to somebody halfway through a shift, and it
 * cannot over-grant either, because a role's defaults are the floor and the
 * ceiling of what the role alone allows.
 *
 * The service client bypasses row-level security, so the `company_id` filter
 * beside the `user_id` one is the tenant boundary — both values come off the
 * session, never off a request.
 */
const loadOverrides = cache(async function loadOverrides(
  userId: string,
  companyId: string,
): Promise<PermissionOverrides> {
  const { data, error } = await createSupabaseServiceClient()
    .from('company_users')
    .select('permissions_json')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) {
    logger.error('Permission override lookup failed; falling back to the role defaults', {
      module: 'lib/permissions',
      userId,
      companyId,
      error: error.message,
    });
    return {};
  }

  return normalizePermissionOverrides((data as { permissions_json?: unknown } | null)?.permissions_json);
});

/**
 * What the person on this request may do, memoised for the request.
 *
 * A super admin holds everything, whether they are on the platform surfaces or
 * inside a customer's workspace: `getSessionUser()` already reports them as that
 * company's admin while impersonating, and they have no membership row there, so
 * they resolve to the company-admin defaults with no overrides. That is correct
 * — an operator looking at a customer account is not a member of it and must not
 * be narrowed by one member's tick boxes.
 */
export const getEffectivePermissions = cache(async function getEffectivePermissions(): Promise<
  Set<Permission>
> {
  const user = await getSessionUser();
  if (!user) return new Set<Permission>();
  if (user.isSuperAdmin && !user.impersonation) return new Set<Permission>(PERMISSIONS);
  if (!user.companyId || !user.role) return new Set<Permission>();

  // An impersonating super admin has no row of their own in the company they are
  // looking at, so there is nothing to read and nothing that could narrow them.
  const overrides = user.impersonation ? {} : await loadOverrides(user.userId, user.companyId);
  return resolvePermissions(user.role, overrides);
});

/** Does the signed-in person hold `permission`? */
export async function hasPermission(permission: Permission): Promise<boolean> {
  return (await getEffectivePermissions()).has(permission);
}

/**
 * Throwing variant, for route handlers and server actions that return `void` —
 * `handleApiError` already turns a `ForbiddenError` into the 403 the client
 * expects.
 *
 * NOT for a `useFormState` action. A thrown error inside one of those hits the
 * error boundary instead of the message the person is reading; those actions
 * return `{ error: … }` and use `permissionDenied()` below for the wording.
 */
export async function requirePermission(permission: Permission): Promise<void> {
  if (!(await hasPermission(permission))) {
    throw new ForbiddenError(permissionDenied(permission));
  }
}

/**
 * Page guard. Redirects to the person's own home exactly as `requireRole()`
 * does, so somebody who follows a link to a screen they cannot open lands
 * somewhere they can work instead of on a dead end.
 */
export async function requirePermissionPage(permission: Permission): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!(await hasPermission(permission))) redirect(homePathFor(user));
}

/** The refusal, in the words of the person reading it. */
export function permissionDenied(permission: Permission): string {
  return `You do not have permission to ${PERMISSION_LABELS[permission].toLowerCase()}. Ask an owner of this account to give you access.`;
}
