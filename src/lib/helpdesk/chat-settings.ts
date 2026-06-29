import { createSupabaseServiceClient } from '@/lib/db/server';

export interface HelpdeskChatSettings {
  enabled: boolean;
  showMode: 'floating' | 'embedded' | 'hidden';
  allowedRoles: string[];
  allowedRoutes: string[];
  blockedRoutes: string[];
  autoOpen: boolean;
  position: 'left' | 'right';
}

export const DEFAULT_HELPDESK_CHAT_SETTINGS: HelpdeskChatSettings = {
  enabled: true,
  showMode: 'floating',
  allowedRoles: ['admin', 'manager', 'staff'],
  allowedRoutes: ['dashboard', 'inventory/*', 'purchase/*', 'reports/*', 'customers/*', 'orders/*'],
  blockedRoutes: ['login', 'payment', 'checkout', 'customer-facing/*', 'customer-display/*'],
  autoOpen: false,
  position: 'right',
};

function arr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

function normalizeRoute(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function routeMatches(pattern: string, route: string): boolean {
  const p = normalizeRoute(pattern);
  const r = normalizeRoute(route);
  if (!p) return false;
  if (p === '*') return true;
  if (p.endsWith('/*')) return r === p.slice(0, -2) || r.startsWith(p.slice(0, -1));
  return r === p || r.includes(p);
}

export async function getHelpdeskChatSettings(companyId: string): Promise<HelpdeskChatSettings> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('helpdesk_chat_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return DEFAULT_HELPDESK_CHAT_SETTINGS;
  return {
    enabled: data.enabled !== false,
    showMode: (data.show_mode as HelpdeskChatSettings['showMode']) ?? DEFAULT_HELPDESK_CHAT_SETTINGS.showMode,
    allowedRoles: arr(data.allowed_roles, DEFAULT_HELPDESK_CHAT_SETTINGS.allowedRoles),
    allowedRoutes: arr(data.allowed_routes, DEFAULT_HELPDESK_CHAT_SETTINGS.allowedRoutes),
    blockedRoutes: arr(data.blocked_routes, DEFAULT_HELPDESK_CHAT_SETTINGS.blockedRoutes),
    autoOpen: Boolean(data.auto_open),
    position: (data.position as HelpdeskChatSettings['position']) ?? DEFAULT_HELPDESK_CHAT_SETTINGS.position,
  };
}

export function canShowHelpdeskChat(
  settings: HelpdeskChatSettings,
  params: { route?: string | null; role?: string | null },
): boolean {
  if (!settings.enabled || settings.showMode === 'hidden') return false;
  const role = String(params.role ?? '').toLowerCase();
  if (settings.allowedRoles.length && role && !settings.allowedRoles.map((r) => r.toLowerCase()).includes(role)) {
    return false;
  }
  const route = normalizeRoute(params.route);
  if (!route) return true;
  if (settings.blockedRoutes.some((pattern) => routeMatches(pattern, route))) return false;
  if (!settings.allowedRoutes.length) return true;
  return settings.allowedRoutes.some((pattern) => routeMatches(pattern, route));
}
