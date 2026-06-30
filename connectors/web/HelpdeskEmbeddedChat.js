export const defaultHelpdeskChatSettings = {
  enabled: true,
  showMode: 'floating',
  allowedRoles: [],
  allowedRoutes: [],
  blockedRoutes: ['login', 'payment', 'checkout', 'customer-facing/*', 'customer-display/*'],
  autoOpen: false,
  position: 'right',
};

function normalizeRoute(route) {
  return String(route || '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
}

function routeMatches(pattern, route) {
  const p = normalizeRoute(pattern);
  const r = normalizeRoute(route);
  if (!p) return false;
  if (p === '*') return true;
  if (p.endsWith('/*')) return r === p.slice(0, -2) || r.startsWith(p.slice(0, -1));
  return r === p || r.includes(p);
}

export function shouldShowHelpdeskChat(settings, { route, role }) {
  const cfg = { ...defaultHelpdeskChatSettings, ...(settings || {}) };
  if (!cfg.enabled || cfg.showMode === 'hidden') return false;
  const currentRoute = normalizeRoute(route);
  if (!currentRoute) return true;
  if ((cfg.blockedRoutes || []).some((pattern) => routeMatches(pattern, currentRoute))) return false;
  if (!cfg.allowedRoutes?.length) return true;
  return cfg.allowedRoutes.some((pattern) => routeMatches(pattern, currentRoute));
}

export class HelpdeskEmbeddedChatClient {
  constructor({ baseUrl, token, staffRole, getRoute, onOpenRoute }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!token || !String(token).startsWith('hdk_')) {
      throw new Error('Connector token is required. Use a backend proxy or a trusted staff-only page with the hdk_ token from Switch&Save Help Desk.');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.staffRole = staffRole || 'staff';
    this.getRoute = getRoute || (() => 'dashboard');
    this.onOpenRoute = onOpenRoute || (() => false);
  }

  async ask(text) {
    const res = await fetch(`${this.baseUrl}/api/helpdesk/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        currentRoute: this.getRoute(),
        staffRole: this.staffRole,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Help Desk chat failed');
    return data;
  }

  openNavigationTarget(routeId) {
    return this.onOpenRoute(routeId);
  }
}
