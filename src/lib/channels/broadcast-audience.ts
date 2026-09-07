/**
 * Broadcast audience resolution.
 *
 * Kept pure (data in, identifiers out) so the targeting rules — which decide
 * who receives marketing — can be asserted in tests, and so the cron
 * dispatcher stays a thin loop over the result.
 */

export type BroadcastAudience = 'all_leads' | 'opted_in' | 'tag' | 'segment' | 'custom';

export interface AudienceContact {
  /** Phone in "+digits" form, or an email address. */
  identifier: string;
  tags?: string[];
  status?: string | null;
}

export interface AudienceFilter {
  tag?: string;
  tags?: string[];
  status?: string;
  statuses?: string[];
  contacts?: string[];
}

export interface AudienceContext {
  /** Contacts who explicitly opted out — always excluded, whatever the audience. */
  optedOut: Set<string>;
  /** Contacts who explicitly opted in — the only ones `opted_in` targets. */
  optedIn?: Set<string>;
}

function normalizeAudience(value: unknown): BroadcastAudience {
  const v = String(value ?? 'all_leads');
  return v === 'opted_in' || v === 'tag' || v === 'segment' || v === 'custom' ? v : 'all_leads';
}

function wanted(filter: AudienceFilter, single: 'tag' | 'status', plural: 'tags' | 'statuses'): string[] {
  const list = [...(filter[plural] ?? []), ...(filter[single] ? [filter[single] as string] : [])];
  return list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * Pick the recipients for one broadcast.
 *
 * An opt-out always wins: a contact who sent STOP is dropped even when the
 * company targeted them explicitly with a `custom` list.
 */
export function resolveAudience(
  contacts: AudienceContact[],
  spec: { audience: unknown; filter?: AudienceFilter | null },
  ctx: AudienceContext,
): string[] {
  const audience = normalizeAudience(spec.audience);
  const filter = spec.filter ?? {};

  let pool: AudienceContact[] = contacts.filter((c) => Boolean(c && c.identifier));

  if (audience === 'custom') {
    const explicit = (filter.contacts ?? []).map((s) => String(s).trim()).filter(Boolean);
    const known = new Map(pool.map((c) => [c.identifier, c]));
    pool = explicit.map((identifier) => known.get(identifier) ?? { identifier });
  } else if (audience === 'opted_in') {
    const optedIn = ctx.optedIn ?? new Set<string>();
    pool = pool.filter((c) => optedIn.has(c.identifier));
  } else if (audience === 'tag') {
    const tags = wanted(filter, 'tag', 'tags');
    if (tags.length === 0) return [];
    pool = pool.filter((c) => (c.tags ?? []).some((t) => tags.includes(String(t).trim().toLowerCase())));
  } else if (audience === 'segment') {
    const statuses = wanted(filter, 'status', 'statuses');
    if (statuses.length === 0) return [];
    pool = pool.filter((c) => statuses.includes(String(c.status ?? '').trim().toLowerCase()));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    if (ctx.optedOut.has(c.identifier)) continue;
    if (seen.has(c.identifier)) continue;
    seen.add(c.identifier);
    out.push(c.identifier);
  }
  return out;
}
