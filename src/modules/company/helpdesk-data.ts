import { createSupabaseServiceClient } from '@/lib/db/server';
import { getHelpdeskChatSettings, type HelpdeskChatSettings } from '@/lib/helpdesk/chat-settings';
import { getCompanyId } from './data';

export interface HelpDeskProduct {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  currency: string | null;
  status: string | null;
  quantity: number;
  inStock: boolean;
}

export interface HelpDeskOrder {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string | null;
  fulfillmentStatus: string | null;
  total: number | null;
  currency: string | null;
  placedAt: string | null;
}

export interface HelpDeskCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export async function getHelpDeskOverview() {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [{ data: products, error: productError }, { data: orders }, { data: customers }] =
    await Promise.all([
      sb
        // Stock is only ever shown against the 50 products below, so the
        // inventory rows come back embedded under them. Read on its own it was
        // the company's ENTIRE inventory table — unbounded in the catalogue
        // size — and all but fifty products' worth was thrown away. Embedding
        // keeps that to one round trip, which is the cost that matters here.
        .from('synced_products')
        .select('id,title,sku,price,currency,status,synced_inventory(quantity,in_stock)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50),
      sb
        .from('synced_orders')
        .select('id,order_number,customer_name,status,fulfillment_status,total,currency,placed_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(25),
      sb
        .from('synced_customers')
        .select('id,name,email,phone')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

  if (productError) throw productError;

  // A product can carry several inventory rows (locations, variants), so the
  // quantities are still summed per product exactly as before.
  const stockByProduct = new Map<string, { quantity: number; inStock: boolean }>();
  for (const row of (products ?? []) as Array<Record<string, unknown>>) {
    const productId = row.id as string;
    if (!productId) continue;
    const stock = { quantity: 0, inStock: false };
    const rows = Array.isArray(row.synced_inventory) ? row.synced_inventory : [];
    for (const entry of rows as Array<Record<string, unknown>>) {
      const quantity = (entry.quantity as number) ?? 0;
      stock.quantity += quantity;
      stock.inStock = stock.inStock || Boolean(entry.in_stock) || quantity > 0;
    }
    stockByProduct.set(productId, stock);
  }

  return {
    products: (products ?? []).map((row) => {
      const product = row as Record<string, unknown>;
      const stock = stockByProduct.get(product.id as string) ?? { quantity: 0, inStock: false };
      return {
        id: product.id as string,
        title: product.title as string,
        sku: (product.sku as string) ?? null,
        price: (product.price as number) ?? null,
        currency: (product.currency as string) ?? null,
        status: (product.status as string) ?? null,
        quantity: stock.quantity,
        inStock: stock.inStock,
      } satisfies HelpDeskProduct;
    }),
    orders: (orders ?? []).map((row) => {
      const order = row as Record<string, unknown>;
      return {
        id: order.id as string,
        orderNumber: (order.order_number as string) ?? null,
        customerName: (order.customer_name as string) ?? null,
        status: (order.status as string) ?? null,
        fulfillmentStatus: (order.fulfillment_status as string) ?? null,
        total: (order.total as number) ?? null,
        currency: (order.currency as string) ?? null,
        placedAt: (order.placed_at as string) ?? null,
      } satisfies HelpDeskOrder;
    }),
    customers: (customers ?? []).map((row) => {
      const customer = row as Record<string, unknown>;
      return {
        id: customer.id as string,
        name: (customer.name as string) ?? null,
        email: (customer.email as string) ?? null,
        phone: (customer.phone as string) ?? null,
      } satisfies HelpDeskCustomer;
    }),
  };
}

export interface HelpdeskConnectorRow {
  id: string;
  publicId: string;
  platform: string;
  name: string;
  status: string;
  appVersion: string | null;
  manifestRevision: number;
  resyncRequestedAt: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  activeDeliveryMode: string | null;
  connectionState: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  lastEventLatencyMs: number | null;
  createdAt: string;
  draftDocs: number;
  approvedDocs: number;
  actions: number;
  enabledActions: number;
}

export interface HelpdeskConnectorDocumentRow {
  id: string;
  connectorId: string;
  externalKey: string;
  connectorName: string;
  platform: string;
  module: string;
  screen: string;
  path: string | null;
  purpose: string | null;
  content: string;
  status: string;
  changeType: string;
  steps: string[];
  fields: Array<{ name: string; required: boolean; description: string | null }>;
  commonErrors: string[];
  actions: string[];
  navigation: { label: string | null; routeId: string | null } | null;
  reviewNote: string | null;
  updatedAt: string;
}

export interface HelpdeskConnectorActionRow {
  id: string;
  connectorId: string;
  connectorName: string;
  name: string;
  description: string;
  actionType: string;
  risk: string;
  requiredFields: string[];
  optionalFields: string[];
  allowedRoles: string[];
  needsConfirmation: boolean;
  isEnabled: boolean;
}

export interface HelpdeskConnectorEventRow {
  id: string;
  connectorName: string;
  eventName: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface HelpdeskHealthLogRow {
  id: string;
  connectorName: string;
  eventType: string;
  deliveryMode: string | null;
  status: string;
  message: string | null;
  actionName: string | null;
  durationMs: number | null;
  eventsReturned: number | null;
  createdAt: string;
}

export interface HelpdeskActionAuditRow {
  id: string;
  connectorName: string | null;
  actionName: string | null;
  source: string;
  status: string;
  confirmationRequired: boolean;
  confirmed: boolean;
  dryRun: boolean;
  question: string | null;
  answer: string | null;
  errorMessage: string | null;
  deliveryMode: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * `helpdesk_connector_health_logs` is append-only: every poll, reconnect and
 * completed event adds a row and nothing has ever removed one, so the table is
 * only ever larger than it was yesterday. Reads of it therefore have to be
 * bounded on BOTH axes — a recent time window and a page of rows — or the Help
 * Desk logs tab gets slower every week until it stops loading. The window and
 * the page size below are what the tab actually renders; nothing fetches more.
 *
 * 30 days matches the default chat retention window this product already uses,
 * so the tab shows the same span of history everything else here does.
 */
export const HELPDESK_HEALTH_LOG_WINDOW_DAYS = 30;
export const HELPDESK_HEALTH_LOG_PAGE_SIZE = 25;

/**
 * How many recent `event_completed` rows fill in the per-connector latency
 * column. It is read separately from the log list, on the
 * (company_id, event_type, created_at desc) index, so latency no longer depends
 * on a completed event happening to land on the page of logs being shown.
 */
const HELPDESK_LATENCY_SAMPLE_SIZE = 50;

export interface HelpdeskHealthLogPage {
  logs: HelpdeskHealthLogRow[];
  /** 1-based, matching the other paged readers in this module. */
  page: number;
  pageSize: number;
  windowDays: number;
  hasMore: boolean;
}

export interface HelpdeskConnectorWorkspace {
  connectors: HelpdeskConnectorRow[];
  draftDocuments: HelpdeskConnectorDocumentRow[];
  actions: HelpdeskConnectorActionRow[];
  events: HelpdeskConnectorEventRow[];
  healthLogs: HelpdeskHealthLogRow[];
  healthLogPage: number;
  healthLogPageSize: number;
  healthLogWindowDays: number;
  healthLogsHaveMore: boolean;
  auditLogs: HelpdeskActionAuditRow[];
  quickPills: string[];
  connectorGeneratedPills: number;
  chatSettings: HelpdeskChatSettings;
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function fields(value: unknown): Array<{ name: string; required: boolean; description: string | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((field) => {
      const x = field as Record<string, unknown>;
      return {
        name: String(x.name ?? ''),
        required: Boolean(x.required),
        description: x.description ? String(x.description) : null,
      };
    })
    .filter((field) => field.name);
}

type HelpdeskServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const HEALTH_LOG_COLUMNS =
  'id,connector_id,event_type,delivery_mode,status,message,action_name,duration_ms,events_returned,created_at';

function healthLogWindowStartIso(): string {
  return new Date(Date.now() - HELPDESK_HEALTH_LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * One page of health logs, newest first, within the window. We deliberately ask
 * for one row MORE than the page holds and use its presence as "there is
 * another page": a `count: 'exact'` would make PostgREST count every row in the
 * table, which is the whole-table read this bound exists to remove.
 *
 * A failed read returns an empty page rather than throwing — this is a
 * diagnostics panel, and it should not be able to take the Help Desk page down.
 */
async function fetchHealthLogPage(
  sb: HelpdeskServiceClient,
  companyId: string,
  page: number,
): Promise<{ rows: Array<Record<string, unknown>>; hasMore: boolean }> {
  const from = (page - 1) * HELPDESK_HEALTH_LOG_PAGE_SIZE;
  const { data } = await sb
    .from('helpdesk_connector_health_logs')
    .select(HEALTH_LOG_COLUMNS)
    .eq('company_id', companyId)
    .gte('created_at', healthLogWindowStartIso())
    .order('created_at', { ascending: false })
    // `.range()` is inclusive at both ends, so this asks for pageSize + 1 rows.
    .range(from, from + HELPDESK_HEALTH_LOG_PAGE_SIZE);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    rows: rows.slice(0, HELPDESK_HEALTH_LOG_PAGE_SIZE),
    hasMore: rows.length > HELPDESK_HEALTH_LOG_PAGE_SIZE,
  };
}

/**
 * Latest round-trip latency per connector. Filtered on `event_type` so it rides
 * the (company_id, event_type, created_at desc) index and reads a fixed handful
 * of rows, instead of hoping a completed event happens to be inside whatever
 * page of the log list the dashboard is showing.
 */
async function fetchConnectorLatencies(
  sb: HelpdeskServiceClient,
  companyId: string,
): Promise<Map<string, number>> {
  const { data } = await sb
    .from('helpdesk_connector_health_logs')
    .select('connector_id,duration_ms')
    .eq('company_id', companyId)
    .eq('event_type', 'event_completed')
    .not('duration_ms', 'is', null)
    .order('created_at', { ascending: false })
    .limit(HELPDESK_LATENCY_SAMPLE_SIZE);

  // Rows arrive newest-first, so the first hit for a connector is its latest.
  const latency = new Map<string, number>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const connectorId = row.connector_id as string | null;
    const ms = row.duration_ms as number | null;
    if (connectorId && typeof ms === 'number' && !latency.has(connectorId)) {
      latency.set(connectorId, ms);
    }
  }
  return latency;
}

function toHealthLogRow(
  row: Record<string, unknown>,
  connectorName: Map<string, string>,
): HelpdeskHealthLogRow {
  const connectorId = row.connector_id as string;
  return {
    id: row.id as string,
    connectorName: connectorName.get(connectorId) ?? 'Connector',
    eventType: row.event_type as string,
    deliveryMode: (row.delivery_mode as string) ?? null,
    status: row.status as string,
    message: (row.message as string) ?? null,
    actionName: (row.action_name as string) ?? null,
    durationMs: (row.duration_ms as number) ?? null,
    eventsReturned: (row.events_returned as number) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Pagination entry point for the health log list, for when the logs tab wants
 * page 2 and beyond without re-reading the whole connector workspace.
 */
export async function getHelpdeskConnectorHealthLogPage(page = 1): Promise<HelpdeskHealthLogPage> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const safePage = Math.max(1, Math.floor(page));

  const { rows, hasMore } = await fetchHealthLogPage(sb, companyId, safePage);

  // Only the connectors named on this page — never the whole connector list.
  const connectorIds = [...new Set(rows.map((row) => row.connector_id as string).filter(Boolean))];
  const connectorName = new Map<string, string>();
  if (connectorIds.length) {
    const { data: connectors } = await sb
      .from('helpdesk_connectors')
      .select('id,name')
      .eq('company_id', companyId)
      .in('id', connectorIds);
    for (const row of (connectors ?? []) as Array<Record<string, unknown>>) {
      connectorName.set(row.id as string, row.name as string);
    }
  }

  return {
    logs: rows.map((row) => toHealthLogRow(row, connectorName)),
    page: safePage,
    pageSize: HELPDESK_HEALTH_LOG_PAGE_SIZE,
    windowDays: HELPDESK_HEALTH_LOG_WINDOW_DAYS,
    hasMore,
  };
}

export async function getHelpdeskConnectorWorkspace(
  options: { healthLogPage?: number } = {},
): Promise<HelpdeskConnectorWorkspace> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const healthLogPageNumber = Math.max(1, Math.floor(options.healthLogPage ?? 1));

  const [
    { data: connectors, error },
    { data: docs },
    { data: actions },
    { data: events },
    healthLogPage,
    latencyByConnector,
    { data: auditLogs },
    { data: quickPills },
    { count: connectorGeneratedPills },
    chatSettings,
  ] =
    await Promise.all([
      sb
        .from('helpdesk_connectors')
        .select('id,public_id,platform,name,status,app_version,manifest_revision,resync_requested_at,last_seen_at,last_sync_at,active_delivery_mode,connection_state,last_poll_at,last_error,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
      sb
        .from('helpdesk_connector_documents')
        .select('id,connector_id,external_key,platform,module,screen,path,purpose,content,status,change_type,source_json,review_note,ignored_at,updated_at')
        .eq('company_id', companyId)
        .is('ignored_at', null)
        .order('updated_at', { ascending: false })
        .limit(50),
      sb
        .from('helpdesk_connector_actions')
        .select('id,connector_id,name,description,action_type,risk,required_fields,optional_fields,allowed_roles,needs_confirmation,is_enabled')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
        .limit(100),
      sb
        .from('helpdesk_connector_events')
        .select('id,connector_id,event_name,status,error_message,created_at,completed_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(25),
      fetchHealthLogPage(sb, companyId, healthLogPageNumber),
      fetchConnectorLatencies(sb, companyId),
      sb
        .from('helpdesk_action_audit_logs')
        .select('id,connector_id,action_name,source,status,confirmation_required,confirmed,dry_run,question,answer,error_message,delivery_mode,created_at,completed_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50),
      sb
        .from('bot_quick_actions')
        .select('label')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .in('audience', ['internal', 'both'])
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(8),
      sb
        .from('bot_quick_actions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('source', 'connector')
        .in('audience', ['internal', 'both']),
      getHelpdeskChatSettings(companyId),
    ]);
  if (error) throw error;

  const connectorName = new Map<string, string>();
  for (const row of connectors ?? []) {
    connectorName.set((row as { id: string }).id, (row as { name: string }).name);
  }

  const docCounts = new Map<string, { draft: number; approved: number }>();
  for (const row of docs ?? []) {
    const x = row as Record<string, unknown>;
    const connectorId = x.connector_id as string;
    const current = docCounts.get(connectorId) ?? { draft: 0, approved: 0 };
    if (x.status === 'approved') current.approved += 1;
    if (x.status === 'draft') current.draft += 1;
    docCounts.set(connectorId, current);
  }

  const actionCounts = new Map<string, { total: number; enabled: number }>();
  for (const row of actions ?? []) {
    const x = row as Record<string, unknown>;
    const connectorId = x.connector_id as string;
    const current = actionCounts.get(connectorId) ?? { total: 0, enabled: 0 };
    current.total += 1;
    if (x.is_enabled) current.enabled += 1;
    actionCounts.set(connectorId, current);
  }

  return {
    connectors: (connectors ?? []).map((row) => {
      const x = row as Record<string, unknown>;
      const counts = docCounts.get(x.id as string) ?? { draft: 0, approved: 0 };
      const actionCount = actionCounts.get(x.id as string) ?? { total: 0, enabled: 0 };
      return {
        id: x.id as string,
        publicId: x.public_id as string,
        platform: x.platform as string,
        name: x.name as string,
        status: x.status as string,
        appVersion: (x.app_version as string) ?? null,
        manifestRevision: Number(x.manifest_revision ?? 1),
        resyncRequestedAt: (x.resync_requested_at as string) ?? null,
        lastSeenAt: (x.last_seen_at as string) ?? null,
        lastSyncAt: (x.last_sync_at as string) ?? null,
        activeDeliveryMode: (x.active_delivery_mode as string) ?? null,
        connectionState: (x.connection_state as string) ?? null,
        lastPollAt: (x.last_poll_at as string) ?? null,
        lastError: (x.last_error as string) ?? null,
        lastEventLatencyMs: latencyByConnector.get(x.id as string) ?? null,
        createdAt: x.created_at as string,
        draftDocs: counts.draft,
        approvedDocs: counts.approved,
        actions: actionCount.total,
        enabledActions: actionCount.enabled,
      };
    }),
    draftDocuments: (docs ?? [])
      .filter((row) => {
        const x = row as { status?: string; ignored_at?: string | null };
        return x.status === 'draft' && !x.ignored_at;
      })
      .map((row) => {
        const x = row as Record<string, unknown>;
        const connectorId = x.connector_id as string;
        const source = (x.source_json as Record<string, unknown> | null) ?? {};
        const nav = source.navigation as Record<string, unknown> | undefined;
        return {
          id: x.id as string,
          connectorId,
          externalKey: x.external_key as string,
          connectorName: connectorName.get(connectorId) ?? 'Connector',
          platform: x.platform as string,
          module: x.module as string,
          screen: x.screen as string,
          path: (x.path as string) ?? null,
          purpose: (x.purpose as string) ?? null,
          content: x.content as string,
          status: x.status as string,
          changeType: (x.change_type as string) ?? 'new',
          steps: arr(source.steps),
          fields: fields(source.fields),
          commonErrors: arr(source.commonErrors),
          actions: arr(source.actions),
          navigation: nav
            ? {
                label: nav.label ? String(nav.label) : null,
                routeId: nav.routeId ? String(nav.routeId) : null,
              }
            : null,
          reviewNote: (x.review_note as string) ?? null,
          updatedAt: x.updated_at as string,
        };
      }),
    actions: (actions ?? []).map((row) => {
      const x = row as Record<string, unknown>;
      const connectorId = x.connector_id as string;
      return {
        id: x.id as string,
        connectorId,
        connectorName: connectorName.get(connectorId) ?? 'Connector',
        name: x.name as string,
        description: x.description as string,
        actionType: x.action_type as string,
        risk: x.risk as string,
        requiredFields: arr(x.required_fields),
        optionalFields: arr(x.optional_fields),
        allowedRoles: arr(x.allowed_roles),
        needsConfirmation: Boolean(x.needs_confirmation),
        isEnabled: Boolean(x.is_enabled),
      };
    }),
    events: (events ?? []).map((row) => {
      const x = row as Record<string, unknown>;
      const connectorId = x.connector_id as string;
      return {
        id: x.id as string,
        connectorName: connectorName.get(connectorId) ?? 'Connector',
        eventName: x.event_name as string,
        status: x.status as string,
        errorMessage: (x.error_message as string) ?? null,
        createdAt: x.created_at as string,
        completedAt: (x.completed_at as string) ?? null,
      };
    }),
    healthLogs: healthLogPage.rows.map((row) => toHealthLogRow(row, connectorName)),
    healthLogPage: healthLogPageNumber,
    healthLogPageSize: HELPDESK_HEALTH_LOG_PAGE_SIZE,
    healthLogWindowDays: HELPDESK_HEALTH_LOG_WINDOW_DAYS,
    healthLogsHaveMore: healthLogPage.hasMore,
    auditLogs: (auditLogs ?? []).map((row) => {
      const x = row as Record<string, unknown>;
      const connectorId = x.connector_id as string | undefined;
      return {
        id: x.id as string,
        connectorName: connectorId ? connectorName.get(connectorId) ?? 'Connector' : null,
        actionName: (x.action_name as string) ?? null,
        source: x.source as string,
        status: x.status as string,
        confirmationRequired: Boolean(x.confirmation_required),
        confirmed: Boolean(x.confirmed),
        dryRun: Boolean(x.dry_run),
        question: (x.question as string) ?? null,
        answer: (x.answer as string) ?? null,
        errorMessage: (x.error_message as string) ?? null,
        deliveryMode: (x.delivery_mode as string) ?? null,
        createdAt: x.created_at as string,
        completedAt: (x.completed_at as string) ?? null,
      };
    }),
    quickPills: (quickPills ?? []).map((row) => String((row as { label?: string }).label ?? '')).filter(Boolean),
    connectorGeneratedPills: connectorGeneratedPills ?? 0,
    chatSettings,
  };
}
