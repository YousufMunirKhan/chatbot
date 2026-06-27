import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const packageFiles = {
  android: ['connectors/android/README.md', 'connectors/android/HelpdeskConnectorClient.kt'],
  dotnet: [
    'connectors/dotnet/README.md',
    'connectors/dotnet/Program.cs',
    'connectors/dotnet/SwitchSave.HelpdeskConnector.csproj',
  ],
  web: ['connectors/web/README.md', 'connectors/web/HelpdeskConnectorClient.js'],
} as const;

type ConnectorPlatform = keyof typeof packageFiles;

function isConnectorPlatform(platform: string): platform is ConnectorPlatform {
  return platform === 'android' || platform === 'dotnet' || platform === 'web';
}

function setupGuide(platform: ConnectorPlatform, baseUrl: string): string {
  const title = platform === 'android' ? 'Android' : platform === 'dotnet' ? '.NET' : 'Web';
  const runHint =
    platform === 'android'
      ? 'Copy HelpdeskConnectorClient.kt into your Android app and call runCycle() from a worker or controlled background job.'
      : platform === 'web'
        ? 'Use HelpdeskConnectorClient.js from your web app backend, or from a trusted authenticated admin page only.'
      : 'Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN, then run dotnet run --project SwitchSave.HelpdeskConnector.csproj.';

  return [
    `# ${title} Help Desk Connector Setup`,
    '',
    '## Values from Dashboard',
    '',
    `Base URL: ${baseUrl}`,
    'Connector token: copy the one-time hdk_ token from the Help Desk dashboard.',
    '',
    '## Install',
    '',
    runHint,
    '',
    '## Required Flow',
    '',
    '1. Check status.',
    '2. If syncRequired is true, sync documents and actions.',
    '3. Poll queued events.',
    '4. Execute only mapped local handlers.',
    '5. Send completed or failed result.',
    '',
    '## How Data Is Received',
    '',
    '- The platform receives help documentation and an action manifest during sync.',
    '- The platform does not receive your full database.',
    '- When a user asks for live data, the bot queues an event with the approved action name and input fields.',
    '- The connector receives that event while polling, runs the matching local handler, and posts back a small JSON response.',
    '- The bot reads that response and explains it to the user.',
    '',
    '## Safety Rule',
    '',
    'Do not send raw database tables to the platform. Return only the minimal response needed for the bot answer.',
  ].join('\n');
}

export async function GET(req: Request, { params }: { params: { platform: string } }) {
  if (!isConnectorPlatform(params.platform)) {
    return NextResponse.json({ error: 'unsupported_connector_platform' }, { status: 404 });
  }

  const baseUrl = env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const root = process.cwd();
  const zip = new JSZip();
  const folderName = `switchsave-helpdesk-${params.platform}`;

  zip.file(`${folderName}/SETUP.md`, setupGuide(params.platform, baseUrl.replace(/\/+$/, '')));
  zip.file(`${folderName}/ACTION_FORMAT.json`, JSON.stringify(actionFormatExample(), null, 2));

  for (const file of packageFiles[params.platform]) {
    const absolutePath = path.join(root, file);
    const content = await fs.readFile(absolutePath);
    zip.file(`${folderName}/${path.basename(file)}`, content);
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folderName}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}

function actionFormatExample() {
  return {
    syncPayload: {
      appVersion: 'your-app-1.0.0',
      clientRevision: 0,
      documents: [
        {
          externalKey: 'inventory.add-product',
          module: 'Inventory',
          screen: 'Add Product',
          path: 'Inventory > Products > Add Product',
          purpose: 'Create a new product in the POS catalogue.',
          steps: ['Open Inventory.', 'Open Products.', 'Click Add Product.', 'Fill required fields.', 'Save.'],
          fields: [
            { name: 'Product name', required: true, description: 'Visible product name.' },
            { name: 'Sale price', required: true, description: 'Customer selling price.' },
          ],
          commonErrors: ['Product name is required.'],
          actions: ['search_product', 'update_product_quantity'],
        },
      ],
      actions: [
        {
          name: 'search_product',
          description: 'Search products by name, SKU, or barcode.',
          type: 'read',
          risk: 'low',
          requiredFields: ['query'],
          optionalFields: [],
          allowedRoles: ['admin', 'manager', 'cashier'],
          needsConfirmation: false,
        },
      ],
    },
  };
}
