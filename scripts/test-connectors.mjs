import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';

let failures = 0;
function check(label, condition, extra = '') {
  console.log(`${condition ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!condition) failures++;
}

function loadWebConnectorExports() {
  const eventsSrc = readFileSync('connectors/web/HelpdeskStandardEvents.js', 'utf8')
    .replaceAll('export const ', 'const ')
    .replaceAll('export function ', 'function ');
  const src = readFileSync('connectors/web/HelpdeskConnectorClient.js', 'utf8')
    .replace(/^import .*HelpdeskStandardEvents\.js';\r?\n\r?\n/, '')
    .replaceAll('export class ', 'class ')
    .replaceAll('export function ', 'function ');
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${eventsSrc}\n${src}\nexports = { defaultManifest, auditManifest, previewManifest, standardActionLibrary, standardHelpdeskEvents };`,
    context,
  );
  return context.exports;
}

async function testWebConnectorAudit() {
  const { defaultManifest, auditManifest, previewManifest, standardActionLibrary } = loadWebConnectorExports();
  const manifest = defaultManifest();
  const handlers = Object.fromEntries(manifest.actions.map((a) => [a.name, async () => ({ ok: true })]));
  const audit = auditManifest(manifest, handlers);
  const preview = previewManifest(manifest, handlers);
  const actions = standardActionLibrary();

  check('Web manifest audit has no blockers', audit.ok, audit.blocked.map((x) => x.message).join('; '));
  check('Preview is human readable', preview.includes('Screens') && preview.includes('Actions'));
  check('Standard action library has 26 actions', actions.length === 26, `${actions.length} action(s)`);
  check('Price update action requires confirmation', actions.find((a) => a.name === 'update_product_price')?.needsConfirmation === true);
  check('Danger action is flagged danger/high', actions.find((a) => a.name === 'cancel_order')?.type === 'danger');
}

function testAndroidConnectorKit() {
  const client = readFileSync('connectors/android/HelpdeskConnectorClient.kt', 'utf8');
  const standardEvents = readFileSync('connectors/android/StandardHelpdeskEvents.kt', 'utf8');
  const readme = readFileSync('connectors/android/README.md', 'utf8');

  check('Android WebSocket client exists', client.includes('newWebSocket') && client.includes('/api/helpdesk/connectors/socket'));
  check('Android polling fallback exists', client.includes('startPollingFallback') && client.includes('pollOnce()'));
  check('Android WebSocket reconnect backoff exists', client.includes('scheduleWebSocketReconnect') && client.includes('reconnectDelaySeconds'));
  check('Android action registry exists', client.includes('class HelpdeskActionRegistry') && client.includes('validateRole') && client.includes('validateConfirmation'));
  check('Android navigation registry exists', client.includes('class HelpdeskNavigationRegistry') && client.includes('openNavigationTarget'));
  check('Android manifest audit and diff exist', client.includes('auditManifest') && client.includes('diffManifest'));
  check('Android result safety exists', client.includes('safeResult') && client.includes('redactObject') && client.includes('maxResultBytes'));
  check('Android standard events file has 26 templates', (standardEvents.match(/action\("/g) || []).length === 26);
  check('Android standard action library delegates to event file', client.includes('return StandardHelpdeskEvents.all()'));
  check('Android encrypted token store exists', existsSync('connectors/android/HelpdeskEncryptedTokenStore.kt'));
  check('Android lifecycle observer exists', existsSync('connectors/android/HelpdeskConnectorLifecycleObserver.kt'));
  check('Android preview activity exists', existsSync('connectors/android/HelpdeskConnectorPreviewActivity.kt'));
  check('Android README documents dependencies', readme.includes('okhttp') && readme.includes('security-crypto') && readme.includes('lifecycle-runtime-ktx'));
}

function testQuickActionKit() {
  const quickActions = readFileSync('src/lib/quick-actions.ts', 'utf8');
  const defaults = readFileSync('src/lib/quick-actions-defaults.ts', 'utf8');
  check('Quick actions support audience metadata', quickActions.includes("QuickActionAudience = 'customer' | 'internal' | 'both'"));
  check('Quick actions support contextual selector', quickActions.includes('loadContextualQuickActions'));
  check('Customer and Help Desk defaults are split', defaults.includes('CUSTOMER_DEFAULT_QUICK_ACTIONS') && defaults.includes('HELPDESK_DEFAULT_QUICK_ACTIONS'));
  check('Quick action seeder exists', existsSync('scripts/seed-quick-actions.mjs'));
}

function testHelpdeskChatSurfaceKit() {
  const chatRoute = readFileSync('src/app/api/helpdesk/chat/route.ts', 'utf8');
  const ticketRoute = readFileSync('src/app/api/helpdesk/tickets/route.ts', 'utf8');
  const helpdeskChat = readFileSync('src/modules/company/components/helpdesk-internal-chat.tsx', 'utf8');
  const customerChatRoute = readFileSync('src/app/api/chat/route.ts', 'utf8');
  const settings = readFileSync('src/lib/helpdesk/chat-settings.ts', 'utf8');
  check('Staff-only Help Desk chat endpoint exists', chatRoute.includes('/api/helpdesk/chat') || chatRoute.includes('helpdesk_chat_hidden_by_visibility_rules'));
  check('Help Desk chat enforces visibility settings', chatRoute.includes('canShowHelpdeskChat') && settings.includes('allowedRoutes') && settings.includes('blockedRoutes'));
  check('Help Desk chat supports connector token auth', chatRoute.includes('authenticateHelpdeskConnector'));
  check('Help Desk chat suggests ticket creation', chatRoute.includes('shouldSuggestTicket') && helpdeskChat.includes('Create support ticket'));
  check('Help Desk ticket route creates inbox tickets', ticketRoute.includes("status: 'needs_human'") && ticketRoute.includes('conversation_internal_notes') && ticketRoute.includes("type: 'helpdesk_issue_reported'"));
  check('Customer chat supports human handoff', customerChatRoute.includes("status: 'needs_human'") && customerChatRoute.includes("type: 'human_takeover'"));
  check('Dashboard internal chat component exists', existsSync('src/modules/company/components/helpdesk-internal-chat.tsx'));
  check('Help Desk chat settings form exists', existsSync('src/modules/company/components/helpdesk-chat-settings-form.tsx'));
  check('Connector document review component exists', existsSync('src/modules/company/components/helpdesk-document-review.tsx'));
  check('Web embedded chat SDK exists', existsSync('connectors/web/HelpdeskEmbeddedChat.js'));
  check('Android embedded chat controller exists', existsSync('connectors/android/HelpdeskChatController.kt'));
  check('.NET embedded chat controller exists', existsSync('connectors/dotnet/HelpdeskChatController.cs'));
  check('Standalone WebSocket gateway exists', existsSync('scripts/helpdesk-ws-gateway.mjs'));
}

function testDeveloperDocumentationPack() {
  const requiredDocs = [
    'connectors/HELPDESK_DEVELOPER_HANDOFF.md',
    'connectors/CHANGELOG.md',
    'connectors/events/STANDARD_EVENTS.md',
    'connectors/events/standard-events.json',
    'connectors/events/examples/reports.json',
    'connectors/events/examples/inventory.json',
    'connectors/events/examples/orders.json',
    'connectors/docs/AUTO_DISCOVERY_PLAYBOOK.md',
    'connectors/docs/COMPATIBILITY_POLICY.md',
    'connectors/docs/UPGRADE_GUIDE.md',
    'connectors/docs/UI_COMPONENT_GUIDE.md',
    'connectors/docs/CONNECTOR_TEST_PLAN.md',
    'connectors/laravel/AI_AGENT_LARAVEL.md',
    'connectors/node/AI_AGENT_NODE.md',
    'connectors/react/HELPDESK_REACT_COMPONENT.md',
    'connectors/vue/HELPDESK_VUE_COMPONENT.md',
    'connectors/android/ANDROID_UI_GUIDE.md',
    'connectors/dotnet/WINFORMS_WPF_UI.md',
  ];
  for (const file of requiredDocs) {
    check(`Developer doc exists: ${file}`, existsSync(file));
  }
  const downloadRoute = readFileSync('src/app/api/helpdesk/connectors/download/[platform]/route.ts', 'utf8');
  check('Connector downloads include shared handoff docs', downloadRoute.includes('HELPDESK_DEVELOPER_HANDOFF.md') && downloadRoute.includes('CHANGELOG.md') && downloadRoute.includes('STANDARD_EVENTS.md') && downloadRoute.includes('standard-events.json') && downloadRoute.includes('AUTO_DISCOVERY_PLAYBOOK.md') && downloadRoute.includes('COMPATIBILITY_POLICY.md') && downloadRoute.includes('UPGRADE_GUIDE.md') && downloadRoute.includes('CONNECTOR_TEST_PLAN.md'));
  check('Connector downloads include version manifest', downloadRoute.includes('CONNECTOR_VERSION.json') && downloadRoute.includes('CONNECTOR_PACKAGE_VERSION') && downloadRoute.includes('CONNECTOR_PROTOCOL_VERSION'));
  check('Connector downloads include platform UI helpers', downloadRoute.includes('HelpdeskChatController.kt') && downloadRoute.includes('HelpdeskChatController.cs') && downloadRoute.includes('HelpdeskEmbeddedChat.js'));
  check('Connector downloads include platform event definitions', downloadRoute.includes('StandardHelpdeskEvents.kt') && downloadRoute.includes('StandardHelpdeskEvents.cs') && downloadRoute.includes('HelpdeskStandardEvents.js') && downloadRoute.includes('StandardHelpdeskEvents.php'));
  const actions = readFileSync('src/modules/company/helpdesk-actions.ts', 'utf8');
  const queueForm = readFileSync('src/modules/company/components/helpdesk-connector-form.tsx', 'utf8');
  check('Dashboard action tests support dry-run sandbox', actions.includes('_dryRun') && queueForm.includes('Dry-run sandbox test'));
  check('Dashboard action controls include confirmation setting', actions.includes('confirmationRequired') && readFileSync('src/app/(dashboard)/company/help-desk/page.tsx', 'utf8').includes('Confirm always'));
  check('Help Desk issue reports notify company admins', actions.includes('reportHelpdeskIssueAction') && actions.includes("type: 'helpdesk_issue_reported'") && actions.includes('email: true'));
  check('Help Desk issue reports reach platform admin logs', actions.includes("source: 'helpdesk_issue_report'") && actions.includes("revalidatePath('/super-admin/error-logs')"));
  check('Help Desk issue report form exists', existsSync('src/modules/company/components/helpdesk-issue-report-form.tsx') && readFileSync('src/app/(dashboard)/company/help-desk/page.tsx', 'utf8').includes('HelpdeskIssueReportForm'));
  check('Help Desk issue reports support delivery rules', readFileSync('src/modules/company/notification-options.ts', 'utf8').includes('helpdesk_issue_reported') && readFileSync('src/lib/notification-delivery.ts', 'utf8').includes('helpdesk_issue_reported'));
  const webhooks = readFileSync('src/lib/webhooks.ts', 'utf8');
  const webhookForm = readFileSync('src/modules/company/components/webhook-form.tsx', 'utf8');
  const inboxActions = readFileSync('src/modules/company/inbox-actions.ts', 'utf8');
  const inboxPage = readFileSync('src/app/(dashboard)/company/inbox/page.tsx', 'utf8');
  const inboxDetailPage = readFileSync('src/app/(dashboard)/company/inbox/[id]/page.tsx', 'utf8');
  const supportSettings = readFileSync('src/modules/company/support-settings-data.ts', 'utf8');
  const supportSettingsForm = readFileSync('src/modules/company/components/support-settings-form.tsx', 'utf8');
  const ticketPanel = readFileSync('src/modules/company/components/ticket-panel.tsx', 'utf8');
  const connectorTickets = readFileSync('src/lib/helpdesk/tickets.ts', 'utf8');
  const ticketNumbers = readFileSync('src/lib/tickets/ticket-number.ts', 'utf8');
  const helpdeskPage = readFileSync('src/app/(dashboard)/company/help-desk/page.tsx', 'utf8');
  const helpdeskChat = readFileSync('src/modules/company/components/helpdesk-internal-chat.tsx', 'utf8');
  const helpdeskActions = readFileSync('src/modules/company/helpdesk-actions.ts', 'utf8');
  const ticketRoute = readFileSync('src/app/api/helpdesk/tickets/route.ts', 'utf8');
  check('Ticket automations support created/resolved webhooks', webhooks.includes('ticket.created') && webhooks.includes('ticket.resolved') && webhookForm.includes('Ticket resolved'));
  check('Resolved tickets trigger notifications and automations', inboxActions.includes('resolveTicketAction') && inboxActions.includes("type: 'helpdesk_issue_resolved'") && inboxActions.includes('sendEmail'));
  check('Help Desk support links automation setup', helpdeskPage.includes('Ticket automations') && helpdeskPage.includes('/company/webhooks'));
  check('Inbox has source badges and filters', inboxPage.includes('Connector failures') && inboxPage.includes('Help Desk chat') && inboxPage.includes('conversationSource'));
  check('Inbox shows SLA timers', inboxPage.includes('slaLabel') && readFileSync('src/modules/company/inbox-data.ts', 'utf8').includes('Due in'));
  check('Ticket detail has timeline', inboxDetailPage.includes('Ticket timeline') && inboxDetailPage.includes('Connector action failed') && inboxDetailPage.includes('Note added'));
  check('Ticket forms include templates', readFileSync('src/modules/company/components/helpdesk-issue-report-form.tsx', 'utf8').includes('Report not loading') && ticketPanel.includes('Needs connector update'));
  check('Connector auto-ticket settings exist', supportSettings.includes('autoTicketConnectorFailures') && supportSettingsForm.includes('Auto-create a ticket when a connector action fails'));
  check('Connector issue tickets trigger platform/admin flow', connectorTickets.includes('createConnectorIssueTicket') && connectorTickets.includes("type: 'helpdesk_issue_reported'") && connectorTickets.includes('logAppError'));
  check('Help Desk support previews automation delivery', helpdeskPage.includes('Automation delivery preview') && helpdeskPage.includes('ticket.created'));
  check('Help Desk support can send test ticket automation', helpdeskActions.includes('sendTicketCreatedTestAutomationAction') && helpdeskActions.includes("event: 'ticket.created'") && helpdeskPage.includes('TicketAutomationTestButton'));
  check('Readable ticket numbers exist', ticketNumbers.includes('HD-') && ticketRoute.includes('ticketNumber') && connectorTickets.includes('ticketNumber'));
  check('Help Desk Ask shows connector health warnings', helpdeskPage.includes('connectorHealthAlerts') && helpdeskChat.includes('Connector health warning') && helpdeskChat.includes('Reports/actions may stay queued'));
}

function testStandardEventCatalog() {
  const catalog = JSON.parse(readFileSync('connectors/events/standard-events.json', 'utf8'));
  const webEvents = readFileSync('connectors/web/HelpdeskStandardEvents.js', 'utf8');
  const androidEvents = readFileSync('connectors/android/StandardHelpdeskEvents.kt', 'utf8');
  const dotnetEvents = readFileSync('connectors/dotnet/StandardHelpdeskEvents.cs', 'utf8');
  const laravelEvents = readFileSync('connectors/laravel/StandardHelpdeskEvents.php', 'utf8');
  const names = catalog.events.map((event) => event.name);

  check('Shared standard event catalog has 26 events', names.length === 26, `${names.length} event(s)`);
  check('Shared standard event names are unique', new Set(names).size === names.length);
  for (const name of names) {
    check(`Web event exists: ${name}`, webEvents.includes(`'${name}'`));
    check(`Android event exists: ${name}`, androidEvents.includes(`"${name}"`));
    check(`.NET event exists: ${name}`, dotnetEvents.includes(`"${name}"`));
    check(`Laravel event exists: ${name}`, laravelEvents.includes(`'${name}'`));
  }
  check('Web standard action library delegates to event file', readFileSync('connectors/web/HelpdeskConnectorClient.js', 'utf8').includes('return standardHelpdeskEvents()'));
  check('.NET standard action library delegates to event file', readFileSync('connectors/dotnet/Program.cs', 'utf8').includes('StandardHelpdeskEvents.All'));
  check('Laravel starter delegates to event file', readFileSync('connectors/laravel/HelpdeskLaravelStarter.php', 'utf8').includes('StandardHelpdeskEvents::all()'));
}

async function testAudienceIsolation() {
  const vec = `[${Array(1536).fill(0).join(',')}]`;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('begin');
  try {
    const company = await client.query(
      "insert into public.companies(name, slug, default_language, status) values ('Connector Isolation Check', 'connector-isolation-check-' || substr(md5(random()::text), 1, 8), 'en', 'active') returning id",
    );
    const companyId = company.rows[0].id;
    const docCustomer = await client.query(
      "insert into public.documents(company_id, title, source_type, status, char_count, audience) values ($1, 'Customer Check', 'text', 'ready', 12, 'customer') returning id",
      [companyId],
    );
    const docInternal = await client.query(
      "insert into public.documents(company_id, title, source_type, status, char_count, audience) values ($1, 'Internal Check', 'text', 'ready', 12, 'internal') returning id",
      [companyId],
    );
    await client.query(
      "insert into public.chunks(company_id, document_id, text, contextual_text, embedding, audience) values ($1, $2, 'connectorcheck public customer answer', 'connectorcheck public customer answer', $3::vector, 'customer')",
      [companyId, docCustomer.rows[0].id, vec],
    );
    await client.query(
      "insert into public.chunks(company_id, document_id, text, contextual_text, embedding, audience) values ($1, $2, 'connectorcheck private internal answer', 'connectorcheck private internal answer', $3::vector, 'internal')",
      [companyId, docInternal.rows[0].id, vec],
    );

    const customer = await client.query(
      "select text from public.match_chunks($1, null, $2, 'connectorcheck', 10, 'customer') order by text",
      [companyId, vec],
    );
    const internal = await client.query(
      "select text from public.match_chunks($1, null, $2, 'connectorcheck', 10, 'internal') order by text",
      [companyId, vec],
    );

    check('Customer retrieval excludes internal docs', !customer.rows.some((r) => r.text.includes('private internal')));
    check('Internal retrieval includes internal docs', internal.rows.some((r) => r.text.includes('private internal')));
    check('Internal retrieval can include customer-safe docs', internal.rows.some((r) => r.text.includes('public customer')));
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end().catch(() => {});
  }
}

async function testMigrationState() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const migrations = await client.query(
    "select name from public._migrations where name in ('0034_helpdesk_audience_isolation.sql','0035_connector_delivery_observability.sql','0036_quick_action_audience_context.sql','0037_helpdesk_chat_surface.sql','0038_helpdesk_enterprise_mvp.sql')",
  );
  const names = new Set(migrations.rows.map((r) => r.name));
  const health = await client.query("select to_regclass('public.helpdesk_connector_health_logs') as table_name");
  const audit = await client.query("select to_regclass('public.helpdesk_action_audit_logs') as table_name");
  await client.end();
  check('Audience isolation migration applied', names.has('0034_helpdesk_audience_isolation.sql'));
  check('Delivery observability migration applied', names.has('0035_connector_delivery_observability.sql'));
  check('Quick action audience/context migration applied', names.has('0036_quick_action_audience_context.sql'));
  check('Help Desk chat surface migration applied', names.has('0037_helpdesk_chat_surface.sql'));
  check('Help Desk enterprise MVP migration applied', names.has('0038_helpdesk_enterprise_mvp.sql'));
  check('Connector health log table exists', health.rows[0]?.table_name === 'helpdesk_connector_health_logs');
  check('Help Desk action audit table exists', audit.rows[0]?.table_name === 'helpdesk_action_audit_logs');
}

try {
  await testWebConnectorAudit();
  testAndroidConnectorKit();
  testStandardEventCatalog();
  testQuickActionKit();
  testHelpdeskChatSurfaceKit();
  testDeveloperDocumentationPack();
  await testMigrationState();
  await testAudienceIsolation();
} catch (err) {
  console.error('❌ Connector test error:', err);
  failures++;
}

console.log(failures === 0 ? '\n🎉 Connector tests passed.' : `\n❌ ${failures} connector check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
