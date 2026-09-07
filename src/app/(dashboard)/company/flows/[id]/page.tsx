import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature } from '@/lib/entitlements';
import { listMembers } from '@/modules/company/data';
import {
  getFlow,
  listFlowAnalytics,
  listFlowOptions,
  listIntents,
} from '@/modules/company/flows-data';
import { FlowBuilder } from '@/modules/company/components/flow-builder';

export const dynamic = 'force-dynamic';

export default async function FlowBuilderPage({ params }: { params: { id: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN]);

  // Checked before the flow is loaded, so a company that cannot use the builder
  // never learns whether a given id exists. The builder's own save, publish and
  // trigger actions live in `flows-actions.ts` and gate themselves.
  if (!(await companyHasFeature('flows'))) {
    return <UpgradeNotice feature="flows" backTo={{ href: '/company', label: 'Home' }} />;
  }

  // `getFlow` is scoped to the session's company, so an id belonging to another
  // tenant is indistinguishable from one that does not exist.
  const flow = await getFlow(params.id);
  if (!flow) notFound();

  const [flowOptions, members, intents, analytics] = await Promise.all([
    listFlowOptions(),
    listMembers(),
    listIntents(),
    listFlowAnalytics(flow.id),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={flow.name}
        description={
          flow.description ??
          'Drag blocks onto the canvas and connect them to script exactly how this conversation goes.'
        }
        backTo={{ href: '/company/flows', label: 'Flows' }}
      />

      <FlowBuilder
        flow={flow}
        flowOptions={flowOptions}
        agents={members.map((m) => ({ id: m.userId, name: m.fullName ?? m.email ?? 'Teammate' }))}
        intents={intents.map((i) => ({ id: i.id, name: i.name }))}
        analytics={analytics}
      />
    </div>
  );
}
