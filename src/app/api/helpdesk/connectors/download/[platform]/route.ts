import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const packageFiles = {
  android: [
    'connectors/android/README.md',
    'connectors/android/AI_AGENT_ANDROID.md',
    'connectors/android/ANDROID_UI_GUIDE.md',
    'connectors/android/HelpdeskConnectorClient.kt',
    'connectors/android/HelpdeskChatController.kt',
    'connectors/android/HelpdeskEncryptedTokenStore.kt',
    'connectors/android/HelpdeskAndroidManifestStore.kt',
    'connectors/android/HelpdeskConnectorLifecycleObserver.kt',
    'connectors/android/HelpdeskConnectorPreviewActivity.kt',
    'connectors/android/HelpdeskAndroidAppDetails.kt',
    'connectors/android/HelpdeskQuickStartExample.kt',
  ],
  dotnet: [
    'connectors/dotnet/README.md',
    'connectors/dotnet/AI_AGENT_DOTNET.md',
    'connectors/dotnet/WINFORMS_WPF_UI.md',
    'connectors/dotnet/Program.cs',
    'connectors/dotnet/HelpdeskDotnetAppDetails.cs',
    'connectors/dotnet/HelpdeskChatController.cs',
    'connectors/dotnet/HelpdeskDefaultChatViewModel.cs',
    'connectors/dotnet/SwitchSave.HelpdeskConnector.csproj',
  ],
  web: [
    'connectors/web/README.md',
    'connectors/web/AI_AGENT_WEB.md',
    'connectors/web/HelpdeskConnectorClient.js',
    'connectors/web/HelpdeskWebAppDetails.js',
    'connectors/web/HelpdeskEmbeddedChat.js',
    'connectors/web/HelpdeskDefaultChatUI.js',
  ],
  node: [
    'connectors/node/AI_AGENT_NODE.md',
    'connectors/node/helpdesk-node-starter.mjs',
    'connectors/web/HelpdeskConnectorClient.js',
    'connectors/web/HelpdeskWebAppDetails.js',
    'connectors/web/HelpdeskEmbeddedChat.js',
    'connectors/web/HelpdeskDefaultChatUI.js',
  ],
  laravel: [
    'connectors/laravel/AI_AGENT_LARAVEL.md',
    'connectors/laravel/HelpdeskLaravelStarter.php',
  ],
  react: [
    'connectors/react/HELPDESK_REACT_COMPONENT.md',
    'connectors/web/HelpdeskEmbeddedChat.js',
    'connectors/web/HelpdeskDefaultChatUI.js',
  ],
  vue: [
    'connectors/vue/HELPDESK_VUE_COMPONENT.md',
    'connectors/web/HelpdeskEmbeddedChat.js',
    'connectors/web/HelpdeskDefaultChatUI.js',
  ],
  fullstack: [
    'connectors/web/README.md',
    'connectors/web/AI_AGENT_WEB.md',
    'connectors/web/HelpdeskConnectorClient.js',
    'connectors/web/HelpdeskWebAppDetails.js',
    'connectors/web/HelpdeskEmbeddedChat.js',
    'connectors/web/HelpdeskDefaultChatUI.js',
    'connectors/node/AI_AGENT_NODE.md',
    'connectors/node/helpdesk-node-starter.mjs',
    'connectors/laravel/AI_AGENT_LARAVEL.md',
    'connectors/laravel/HelpdeskLaravelStarter.php',
    'connectors/react/HELPDESK_REACT_COMPONENT.md',
    'connectors/vue/HELPDESK_VUE_COMPONENT.md',
  ],
} as const;

const sharedFiles = [
  'connectors/HELPDESK_DEVELOPER_HANDOFF.md',
  'connectors/AI_AGENT_INTEGRATION_PROMPT.md',
  'connectors/PROTOCOL.md',
  'connectors/docs/AUTO_DISCOVERY_PLAYBOOK.md',
  'connectors/docs/UI_COMPONENT_GUIDE.md',
  'connectors/docs/CONNECTOR_TEST_PLAN.md',
];

type ConnectorPlatform = keyof typeof packageFiles;

function isConnectorPlatform(platform: string): platform is ConnectorPlatform {
  return platform in packageFiles;
}

function setupGuide(platform: ConnectorPlatform, baseUrl: string): string {
  const title =
    platform === 'android' ? 'Android'
      : platform === 'dotnet' ? '.NET'
        : platform === 'node' ? 'Node'
          : platform === 'laravel' ? 'Laravel'
            : platform === 'react' ? 'React'
              : platform === 'vue' ? 'Vue'
                : platform === 'fullstack' ? 'Full Web Stack'
                  : 'Web';
  const runHint =
    platform === 'android'
      ? 'Copy the Kotlin files into your Android app. Open HelpdeskConnectorPreviewActivity, paste the hdk_ connector token, press Save key, then Preview/Audit/Sync. For production, wire HelpdeskQuickStart.setup(...) from your staff/admin Help Desk screen.'
      : platform === 'dotnet'
        ? 'Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN, then run dotnet run --project SwitchSave.HelpdeskConnector.csproj.'
        : platform === 'node'
          ? 'Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN, then run npm run preview or npm run sync:once.'
          : platform === 'laravel'
            ? 'Copy HelpdeskLaravelStarter.php into app/Services/Helpdesk, set env vars, then call preview(), audit(), sync(), and runCycle() from an Artisan command/job.'
            : platform === 'react' || platform === 'vue'
              ? 'Use this UI package for the staff chat screen. Pair it with a backend connector package such as Node, Laravel, or Web.'
              : 'Use HelpdeskConnectorClient.js from your web app backend, or from a trusted authenticated admin page only.';
  const platformSteps =
    platform === 'android'
      ? [
          '',
          '## Android First Run',
          '',
          '1. Add OkHttp, AndroidX Security Crypto, and Lifecycle dependencies.',
          '2. Add the downloaded Kotlin files to a staff/admin-only package.',
          '3. Create a connector in Switch&Save Help Desk and copy the one-time hdk_ token.',
          `4. Open HelpdeskConnectorPreviewActivity and enter Base URL: ${baseUrl}`,
          '5. Paste the hdk_ token and press Save key.',
          '6. Read docs/AUTO_DISCOVERY_PLAYBOOK.md and scan the real Android menus/routes/screens.',
          '7. Edit HelpdeskAndroidAppDetails.kt with every real staff screen, route ID, action, and repository handler.',
          '8. Replace starter preview handlers with HelpdeskAndroidAppDetails.createConnector(...) or HelpdeskQuickStartExample.kt wiring.',
          '9. Press Preview, Audit, Test route for every routeId, then Sync.',
          '10. Use the default chat/setup screen in HelpdeskConnectorPreviewActivity as the staff Help Desk design baseline.',
          '',
          '## What The Android Developer Must Create',
          '',
          '- HelpdeskAndroidAppDetails.kt: real staff screens, fields, steps, common errors, actions, and navigation route IDs.',
          '- Token entry: paste the hdk_ key or save it securely with HelpdeskEncryptedTokenStore.',
          '- Staff Help Desk Activity/Fragment: authenticated staff-only screen where the chat appears.',
          '- Navigation map: routeId -> navController.navigate(...), Activity, Fragment, or deep link.',
          '- Route test: enter routeId in the preview screen and press Test route before Sync.',
          '- Action handlers: approved action names mapped to real repositories/services.',
          '- Lifecycle observer: attach HelpdeskConnectorLifecycleObserver while the Help Desk screen is open.',
          '',
          '## How To Open Help Desk',
          '',
          'Add a staff-only Help Desk menu item in the Android app. On that screen, build the connector, attach HelpdeskConnectorLifecycleObserver, render your chat UI when HelpdeskChatController.shouldShow(settings) returns true, and call helpdeskChat.ask(text) for staff questions.',
        ]
      : platform === 'dotnet'
        ? [
            '',
            '## .NET First Run',
            '',
            '1. Create a connector in Switch&Save Help Desk and copy the one-time hdk_ token.',
            `2. Set HELPDESK_BASE_URL=${baseUrl}`,
            '3. Set HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk.',
            '4. Run the connector from the POS machine or Windows service host.',
          '5. Read docs/AUTO_DISCOVERY_PLAYBOOK.md and scan the real forms/menu commands/routes.',
          '6. Edit HelpdeskDotnetAppDetails.cs with every real form/screen, route command, action, and service method.',
          '7. Confirm Preview/Audit passes, test every route, then let the connector sync and poll events.',
          '8. Bind HelpdeskDefaultChatViewModel.cs to a WinForms/WPF/MAUI/Avalonia panel using the default card design.',
          '',
          '## What The .NET Developer Must Create',
          '',
          '- HelpdeskDotnetAppDetails.cs: real forms/screens, fields, steps, common errors, actions, and route commands.',
          '- Secure token config: HELPDESK_CONNECTOR_TOKEN in service environment, protected appsettings, or existing secret store.',
          '- Staff Help Desk form/panel: authenticated staff-only UI where the chat appears.',
          '- Navigation map: routeId -> WinForms/WPF command, form opener, shell route, or deep link.',
          '- Route test: call HelpdeskDefaultChatViewModel.TestRoute(routeId) before Sync.',
          '- Action handlers: approved action names mapped to real POS/ERP services.',
          '- Worker/service lifecycle: WebSocket first, polling fallback when unavailable.',
          '',
          '## How To Open Help Desk',
            '',
            'Add a staff-only Help Desk menu item in WinForms/WPF/admin UI. On that screen, create HelpdeskChatController with an authenticated HttpClient, show the panel only when ShouldShow(...) returns true, call AskAsync(text), and map route IDs to local forms/screens with OpenRoute(routeId).',
          ]
        : platform === 'node'
          ? [
              '',
              '## Node First Run',
              '',
              '1. Create a connector in Switch&Save Help Desk and copy the one-time hdk_ token.',
              `2. Set HELPDESK_BASE_URL=${baseUrl}`,
              '3. Set HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk.',
              '4. Run npm run preview to confirm the sample manifest and action handlers are clean.',
              '5. Run npm run sync:once to sync docs/actions and poll one time.',
              '6. Replace sampleProductService and sampleReportService in helpdesk-node-starter.mjs with real services.',
              '',
              '## What The Node Developer Must Create',
              '',
              '- Backend worker/job that runs connector.runCycle().',
              '- Backend chat proxy for /api/helpdesk/chat.',
              '- Real product/report/order/customer services.',
              '- Route map in HelpdeskWebAppDetails.js.',
              '- Staff-only admin Help Desk page.',
            ]
          : platform === 'laravel'
            ? [
                '',
                '## Laravel First Run',
                '',
                '1. Create a connector in Switch&Save Help Desk and copy the one-time hdk_ token.',
                `2. Set HELPDESK_BASE_URL=${baseUrl}`,
                '3. Set HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk.',
                '4. Copy HelpdeskLaravelStarter.php to app/Services/Helpdesk/HelpdeskLaravelStarter.php.',
                '5. Call preview() and audit() from tinker or an Artisan command.',
                '6. Call sync() from an Artisan command/job after audit passes.',
                '7. Replace ProductService and ReportService with real Laravel services/Eloquent queries.',
                '',
                '## What The Laravel Developer Must Create',
                '',
                '- Artisan command or queue job for sync/runCycle.',
                '- Backend chat proxy route protected by staff auth.',
                '- Real ProductService and ReportService.',
                '- Route URLs in manifest() and testRoute().',
                '- Staff-only Blade/Livewire/Inertia Help Desk page.',
              ]
            : platform === 'react'
              ? [
                  '',
                  '## React First Run',
                  '',
                  '1. Add the staff-only Help Desk page/component to your admin app.',
                  '2. Render HelpdeskDefaultChatUI.js or adapt HELPDESK_REACT_COMPONENT.md.',
                  '3. Call your backend chat proxy, not Switch&Save directly.',
                  '4. Map routeId values to router.push(...).',
                  '5. Test route IDs in the settings panel before Sync.',
                  '',
                  '## Backend Required',
                  '',
                  'Use Node, Laravel, Web, or another backend package for the connector token, sync, polling, and action handlers.',
                ]
              : platform === 'vue'
                ? [
                    '',
                    '## Vue First Run',
                    '',
                    '1. Add the staff-only Help Desk page/component to your admin app.',
                    '2. Render HelpdeskDefaultChatUI.js or adapt HELPDESK_VUE_COMPONENT.md.',
                    '3. Call your backend chat proxy, not Switch&Save directly.',
                    '4. Map routeId values to router.push(...).',
                    '5. Test route IDs in the settings panel before Sync.',
                    '',
                    '## Backend Required',
                    '',
                    'Use Node, Laravel, Web, or another backend package for the connector token, sync, polling, and action handlers.',
                  ]
                : platform === 'web' || platform === 'fullstack'
          ? [
              '',
              '## Web First Run',
              '',
              '1. Create a connector in Switch&Save Help Desk and copy the one-time hdk_ token.',
              `2. Set HELPDESK_BASE_URL=${baseUrl} on your backend.`,
              '3. Set HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk on your backend.',
              '4. Start a backend worker or controlled admin process that calls connector.runCycle().',
              '5. Keep the hdk_ token out of public browser bundles.',
              '6. Edit HelpdeskWebAppDetails.js with the real pages, route URLs, actions, and backend services.',
              '7. Mount HelpdeskDefaultChatUI.js in the staff admin page for the default chat/settings design.',
              '8. For Node, run helpdesk-node-starter.mjs for preview/audit/sync with sample services.',
              '9. For Laravel, copy HelpdeskLaravelStarter.php into app/Services/Helpdesk and replace sample services.',
              '10. The zip includes package.json scripts: npm run preview, npm run sync:once, npm start.',
              '',
              '## What The Web Developer Must Create',
              '',
              '- HelpdeskWebAppDetails.js: real admin pages, fields, steps, common errors, actions, and route URLs.',
              '- Backend token storage: HELPDESK_CONNECTOR_TOKEN in server environment only.',
              '- Staff Help Desk page/component: authenticated staff-only admin UI.',
              '- Backend chat proxy: frontend calls your backend; backend calls /api/helpdesk/chat with the hdk_ token.',
              '- Navigation map: routeId -> router.push(...), redirect, or admin URL.',
              '- Route test: use the Settings panel in HelpdeskDefaultChatUI.js before Sync.',
              '- Action handlers: approved action names mapped to real backend services.',
              '- Worker process: run connector.runCycle() on backend schedule/job/worker.',
              '- Node starter: helpdesk-node-starter.mjs works immediately with sample data.',
              '- Laravel starter: HelpdeskLaravelStarter.php gives manifest, audit, sync, runCycle, and route test methods.',
              '',
              '## How To Open Help Desk',
              '',
              'Add a staff-only Help Desk page in your admin dashboard. The frontend calls your backend proxy with text/currentRoute/staffRole. The backend attaches Authorization: Bearer HELPDESK_CONNECTOR_TOKEN when calling /api/helpdesk/chat. Map returned route IDs to your local router.',
            ]
          : [];

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
    ...platformSteps,
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

function aiImplementationBrief(platform: ConnectorPlatform, baseUrl: string): string {
  const detailFile =
    platform === 'android'
      ? 'HelpdeskAndroidAppDetails.kt'
      : platform === 'dotnet'
        ? 'HelpdeskDotnetAppDetails.cs'
        : 'HelpdeskWebAppDetails.js';
  const runCommand =
    platform === 'android'
      ? 'Open HelpdeskConnectorPreviewActivity, paste the hdk_ key, then press Save key, Preview, Audit, Sync.'
      : platform === 'dotnet'
        ? 'Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN, then run: dotnet run --project SwitchSave.HelpdeskConnector.csproj'
        : 'Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN on the backend, then call connector.previewManifest(), connector.auditManifest(), and connector.runCycle().';
  const platformTasks =
    platform === 'android'
      ? [
          '- Add Kotlin files to a staff/admin-only package.',
          '- Save token with HelpdeskEncryptedTokenStore.',
          '- Map routeId values to navController.navigate(...), Activity, Fragment, or deep link.',
          '- Create a staff Help Desk Activity/Fragment and attach HelpdeskConnectorLifecycleObserver.',
        ]
      : platform === 'dotnet'
        ? [
            '- Add the C# files to the POS/ERP/admin solution.',
            '- Store HELPDESK_CONNECTOR_TOKEN in service environment, protected appsettings, or the existing secret store.',
            '- Map routeId values to WinForms/WPF commands, form openers, shell routes, or deep links.',
            '- Create a staff Help Desk form/panel and run the connector from a service/worker or controlled admin process.',
          ]
        : [
            '- Keep HELPDESK_CONNECTOR_TOKEN on the backend only.',
            '- Add a backend worker/job that runs connector.runCycle().',
            '- Add a backend chat proxy for /api/helpdesk/chat.',
            '- Map routeId values to router.push(...), redirects, or admin URLs.',
            '- Add a staff-only Help Desk page/component in the admin dashboard.',
          ];

  return [
    '# AI Implementation Brief',
    '',
    'Give this file and the whole unzipped connector folder to Cursor, Claude Code, Codex, or a developer.',
    '',
    '## Objective',
    '',
    'Integrate Switch&Save internal Help Desk into the customer system so staff can ask how-to questions, open known screens, and run approved local actions without uploading the customer database.',
    '',
    '## Values',
    '',
    `Base URL: ${baseUrl}`,
    'Connector token: create it in Switch&Save Help Desk. It starts with hdk_.',
    '',
    '## Edit This First',
    '',
    '1. Read `docs/AUTO_DISCOVERY_PLAYBOOK.md`.',
    '2. Scan the real app menu/router/screen files.',
    `3. Open \`${detailFile}\`.`,
    '4. Replace every sample screen with the discovered real app screens/pages/forms.',
    '5. Replace sample route IDs with real navigation targets.',
    '6. Replace sample action handlers with real repository/service calls.',
    '7. Keep only actions the app can safely support.',
    '',
    '## Build These Pieces',
    '',
    '- Connector token storage.',
    '- Staff-only Help Desk UI entry point.',
    '- Default chat/settings design: Chat/History tabs, greeting, quick questions, category chips, large rounded input, setup/settings panel, and route tester.',
    '- Software map manifest: modules, screens, paths, steps, fields, common errors.',
    '- Navigation map: routeId -> local app route/screen command.',
    '- Default chat/settings UI using the included platform UI helper.',
    '- Action handlers: approved action name -> local service method.',
    '- Preview, audit, and sync flow.',
    '- WebSocket or polling fallback worker.',
    '- A smoke test that clearly says what works now and what still uses sample data.',
    '',
    '## Platform Tasks',
    '',
    ...platformTasks,
    '',
    '## Screen Details To Add',
    '',
    'For every screen/page/form add: externalKey, module, screen, path, purpose, steps, fields, commonErrors, actions, navigation.routeId.',
    'If Preview only shows the starter screens, discovery is incomplete. Continue scanning menus/routes before Sync.',
    '',
    '## Action Details To Add',
    '',
    'For every action add: name, type, risk, requiredFields, optionalFields, allowedRoles, needsConfirmation, and the real local handler.',
    '',
    '## Run/Test',
    '',
    runCommand,
    '',
    'Then confirm:',
    '',
    '- Preview shows real customer screens, not starter samples.',
    '- Audit has no blockers.',
    '- Sync succeeds.',
    '- Staff Help Desk appears only for authenticated staff.',
    '- Customer/public pages never show this Help Desk.',
    '- Navigation buttons open the correct local screens.',
    '- Route verification passes for every routeId in the manifest.',
    '- Read/report actions return small safe JSON.',
    '- Write/update actions require explicit confirmation.',
    '- Health logs appear in Switch&Save.',
    '',
    '## Safety Rules',
    '',
    '- Do not upload database tables or customer records.',
    '- Do not expose the hdk_ token in public browser code.',
    '- Do not let an AI generate and execute raw SQL.',
    '- Do not sync passwords, API keys, connection strings, card numbers, CVV, private keys, or sample customer data.',
    '- Return only the minimal JSON needed for the staff answer.',
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
  zip.file(`${folderName}/AI_IMPLEMENTATION_BRIEF.md`, aiImplementationBrief(params.platform, baseUrl.replace(/\/+$/, '')));
  zip.file(`${folderName}/ACTION_FORMAT.json`, JSON.stringify(actionFormatExample(), null, 2));
  if (params.platform === 'web' || params.platform === 'node' || params.platform === 'fullstack') {
    zip.file(
      `${folderName}/package.json`,
      JSON.stringify(
        {
          private: true,
          type: 'module',
          scripts: {
            preview: 'node helpdesk-node-starter.mjs --preview-only',
            'sync:once': 'node helpdesk-node-starter.mjs --once',
            start: 'node helpdesk-node-starter.mjs',
          },
        },
        null,
        2,
      ),
    );
  }

  for (const file of sharedFiles) {
    const absolutePath = path.join(root, file);
    const content = await fs.readFile(absolutePath);
    zip.file(`${folderName}/${path.basename(file)}`, content);
  }

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
