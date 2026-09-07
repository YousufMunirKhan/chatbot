import { requireRole } from '@/lib/auth';
import { CHANNEL_LABELS, ROLES, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  getInsightCounts,
  getLatestInsightRun,
  listInsights,
  type InsightRow,
  type InsightSeverity,
} from '@/modules/company/insights-data';
import { setInsightStatusAction } from '@/modules/company/insights-actions';
import { GenerateInsightsButton } from '@/modules/company/components/generate-insights-button';

export const dynamic = 'force-dynamic';

async function setStatus(formData: FormData) {
  'use server';
  await setInsightStatusAction(formData);
}

const SEVERITY: Record<
  InsightSeverity,
  { label: string; variant: 'destructive' | 'warning' | 'outline' }
> = {
  critical: { label: 'Needs attention', variant: 'destructive' },
  warning: { label: 'Worth a look', variant: 'warning' },
  info: { label: 'Good to know', variant: 'outline' },
};

const CATEGORY_LABELS: Record<string, string> = {
  knowledge_gap: 'Missing information',
  answer_quality: 'Answer quality',
  response_time: 'Reply speed',
  channel: 'A channel',
  flow: 'A guided chat',
  sales: 'Sales',
  consent: 'Consent',
  other: 'General',
};

/**
 * The keys `src/lib/ai/insights/rules.ts` writes into a finding's evidence.
 *
 * They were printed with the underscores swapped for spaces, so an owner read
 * "sla breach rate" and "nodeType" as the term in a definition list. Only the
 * handful of keys the rules actually emit are named here; anything a future
 * rule adds degrades through `humanizeToken` rather than reappearing raw.
 */
const EVIDENCE_KEY_LABELS: Record<string, string> = {
  before: 'Rating before',
  after: 'Rating now',
  sample: 'Ratings counted',
  value: 'Current figure',
  breached: 'Answered too late',
  tracked: 'Chats measured',
  escalated: 'Passed to a person',
  total: 'Chats in total',
  channel: 'Where',
  flowId: 'Guided chat',
  nodeId: 'Step',
  nodeType: 'Kind of step',
  entered: 'People who got here',
  continued: 'People who carried on',
  current: 'This period',
  previous: 'The period before',
  change: 'Change',
};

/** Numbers behind a finding, shown plainly so the claim can be checked. */
function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const examples = Array.isArray(evidence.examples) ? (evidence.examples as string[]) : [];
  if (examples.length > 0) {
    return (
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <p className="mb-1 font-medium">What people actually asked</p>
        <ul className="space-y-1 text-muted-foreground">
          {examples.map((e, i) => (
            <li key={i}>&ldquo;{e}&rdquo;</li>
          ))}
        </ul>
      </div>
    );
  }

  const entries = Object.entries(evidence).filter(
    ([key, value]) =>
      key !== 'source' &&
      key !== 'metric' &&
      (typeof value === 'number' || typeof value === 'string'),
  );
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md bg-muted/40 p-3 text-sm">
      <p className="mb-1 font-medium">The numbers</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
        {entries.map(([key, value]) => (
          <span key={key} className="whitespace-nowrap">
            <dt className="inline">{labelFor(EVIDENCE_KEY_LABELS, key)}: </dt>
            {/* The `channel` figure is a stored channel token, so the value
                needs naming as well as the key — otherwise the row reads
                "Where: web_chat". */}
            <dd className="inline font-medium text-foreground">
              {key === 'channel' ? labelFor(CHANNEL_LABELS, String(value)) : String(value)}
            </dd>
          </span>
        ))}
      </dl>
    </div>
  );
}

function InsightCard({ insight }: { insight: InsightRow }) {
  const severity = SEVERITY[insight.severity];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={severity.variant}>{severity.label}</Badge>
          {/* `labelFor`, not `?? insight.category`: a category we have not named
              yet must degrade to readable English, not to the stored token. */}
          <Badge variant="outline">{labelFor(CATEGORY_LABELS, insight.category)}</Badge>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(insight.createdAt)}
          </span>
        </div>
        <CardTitle className="text-base">{insight.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{insight.detail}</p>

        {insight.recommendation ? (
          <div className="rounded-md border-s-2 border-primary bg-primary/5 p-3 text-sm">
            <p className="font-medium">What to do</p>
            <p className="text-muted-foreground">{insight.recommendation}</p>
          </div>
        ) : null}

        <Evidence evidence={insight.evidence} />

        <div className="flex flex-wrap gap-2 pt-1">
          {insight.actionHref ? (
            <Button asChild size="sm">
              <a href={insight.actionHref}>{insight.actionLabel ?? 'Open'}</a>
            </Button>
          ) : null}
          <form action={setStatus}>
            <input type="hidden" name="id" value={insight.id} />
            <input type="hidden" name="status" value="done" />
            <Button type="submit" size="sm" variant="outline">
              Mark as sorted
            </Button>
          </form>
          <form action={setStatus}>
            <input type="hidden" name="id" value={insight.id} />
            <input type="hidden" name="status" value="dismissed" />
            <Button type="submit" size="sm" variant="ghost">
              Not relevant
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function InsightsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [insights, counts, run] = await Promise.all([
    listInsights(),
    getInsightCounts(),
    getLatestInsightRun(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="What to fix next"
        description="We read your conversations and tell you what is costing you customers — in order, with the numbers behind each one."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Needs attention"
          value={counts.critical}
          tone={counts.critical > 0 ? 'danger' : 'default'}
        />
        <StatTile
          label="Worth a look"
          value={counts.warning}
          tone={counts.warning > 0 ? 'warning' : 'default'}
        />
        <StatTile label="Good to know" value={counts.info} />
        <StatTile
          label="Sorted"
          value={counts.done}
          tone={counts.done > 0 ? 'success' : 'default'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Check again</CardTitle>
            <CardDescription>
              {run
                ? run.status === 'skipped'
                  ? (run.note ?? 'Not enough conversations yet.')
                  : `Last checked ${formatRelativeTime(run.createdAt)}${run.usedModel ? '' : ' — from your numbers only, no AI key is configured'}.`
                : 'This has not run yet. It also runs on its own once a week.'}
            </CardDescription>
          </div>
          <GenerateInsightsButton />
        </CardHeader>
      </Card>

      {insights.length === 0 ? (
        <EmptyState
          title="Nothing to fix right now"
          body="Either everything is healthy, or there are not enough conversations yet to tell. Findings appear here as your customers use the assistant."
        />
      ) : (
        <div className="space-y-4">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}
