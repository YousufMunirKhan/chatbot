import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    auth: {
      header: 'Authorization: Bearer hdk_your_connector_token',
    },
    supportedPlatforms: ['dotnet', 'android', 'web'],
    dataFlow: [
      'Connector syncs reviewed software help docs and an approved action manifest.',
      'The platform stores docs, actions, and event logs only.',
      'The platform does not store the customer software database.',
      'When the bot needs live data, it queues an event for an approved action.',
      'The connector receives the event from polling, executes a local handler, and posts the result JSON.',
      'The bot uses that JSON to answer the user.',
    ],
    endpoints: {
      status: 'GET /api/helpdesk/connectors/status',
      sync: 'POST /api/helpdesk/connectors/sync',
      pollEvents: 'GET /api/helpdesk/connectors/events',
      sendEventResult: 'POST /api/helpdesk/connectors/events',
    },
    statusResponse: {
      manifestRevision: 2,
      syncRequired: true,
      commands: [{ type: 'resync_manifest', reason: 'Dashboard connector configuration changed.' }],
    },
    syncPayload: {
      appVersion: 'your-app-1.0.0',
      clientRevision: 1,
      documents: [
        {
          externalKey: 'reports.end-of-day',
          module: 'Reports',
          screen: 'End Of Day',
          path: 'Reports > Sales > End Of Day',
          purpose: 'Review sales, cash, card, returns, discounts, and closing totals.',
          steps: ['Open Reports.', 'Choose End Of Day.', 'Select filters.', 'Generate report.'],
          fields: [{ name: 'Date', required: true, description: 'Report date.' }],
          commonErrors: ['Report is empty when no sales exist for the filters.'],
          actions: ['end_of_day_report'],
        },
      ],
      actions: [
        {
          name: 'end_of_day_report',
          description: 'Return end-of-day close summary.',
          type: 'report',
          risk: 'low',
          requiredFields: ['date'],
          optionalFields: ['branch_id', 'cashier_id'],
          allowedRoles: ['admin', 'manager'],
          needsConfirmation: false,
        },
      ],
    },
    eventResultPayload: {
      eventId: '00000000-0000-0000-0000-000000000000',
      status: 'completed',
      response: { total: 12000, currency: 'PKR' },
      error: null,
    },
  });
}
