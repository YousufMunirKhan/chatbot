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

  const [{ data: products, error: productError }, { data: inventory }, { data: orders }, { data: customers }] =
    await Promise.all([
      sb
        .from('synced_products')
        .select('id,title,sku,price,currency,status')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50),
      sb.from('synced_inventory').select('product_id,quantity,in_stock').eq('company_id', companyId),
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

  const stockByProduct = new Map<string, { quantity: number; inStock: boolean }>();
  for (const row of inventory ?? []) {
    const productId = (row as { product_id?: string }).product_id;
    if (!productId) continue;
    const current = stockByProduct.get(productId) ?? { quantity: 0, inStock: false };
    const quantity = (row as { quantity?: number }).quantity ?? 0;
    current.quantity += quantity;
    current.inStock = current.inStock || Boolean((row as { in_stock?: boolean }).in_stock) || quantity > 0;
    stockByProduct.set(productId, current);
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

export interface HelpdeskConnectorWorkspace {
  connectors: HelpdeskConnectorRow[];
  draftDocuments: HelpdeskConnectorDocumentRow[];
  actions: HelpdeskConnectorActionRow[];
  events: HelpdeskConnectorEventRow[];
  healthLogs: HelpdeskHealthLogRow[];
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

export async function getHelpdeskConnectorWorkspace(): Promise<HelpdeskConnectorWorkspace> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [
    { data: connectors, error },
    { data: docs },
    { data: actions },
    { data: events },
    { data: healthLogs },
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
        .select('id,connector_id,platform,module,screen,path,purpose,content,status,change_type,source_json,review_note,ignored_at,updated_at')
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
      sb
        .from('helpdesk_connector_health_logs')
        .select('id,connector_id,event_type,delivery_mode,status,message,action_name,duration_ms,events_returned,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(25),
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

  // Most-recent round-trip latency per connector, from completed-event health logs
  // (logs are already ordered newest-first, so the first hit per connector wins).
  const latencyByConnector = new Map<string, number>();
  for (const log of healthLogs ?? []) {
    const l = log as Record<string, unknown>;
    const cid = l.connector_id as string;
    const ms = l.duration_ms as number | null;
    if (cid && !latencyByConnector.has(cid) && l.event_type === 'event_completed' && typeof ms === 'number') {
      latencyByConnector.set(cid, ms);
    }
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
    healthLogs: (healthLogs ?? []).map((row) => {
      const x = row as Record<string, unknown>;
      const connectorId = x.connector_id as string;
      return {
        id: x.id as string,
        connectorName: connectorName.get(connectorId) ?? 'Connector',
        eventType: x.event_type as string,
        deliveryMode: (x.delivery_mode as string) ?? null,
        status: x.status as string,
        message: (x.message as string) ?? null,
        actionName: (x.action_name as string) ?? null,
        durationMs: (x.duration_ms as number) ?? null,
        eventsReturned: (x.events_returned as number) ?? null,
        createdAt: x.created_at as string,
      };
    }),
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
