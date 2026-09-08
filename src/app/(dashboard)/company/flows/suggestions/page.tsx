import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature } from '@/lib/entitlements';
import { formatDate, formatNumber } from '@/lib/format';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  getFlowSuggestionCounts,
  getLatestFlowSuggestionRun,
  listFlowSuggestions,
  type FlowSuggestionRow,
} from '@/modules/company/flow-suggestions-data';
import {
  AcceptFlowSuggestionForm,
  DismissFlowSuggestionForm,
  GenerateFlowSuggestionsButton,
} from '@/modules/company/components/flow-suggestions-controls';
import { FlowSuggestionPreview } from '@/modules/company/components/flow-suggestions-preview';

export const dynamic = 'force-dynamic';

/**
 * Suggested guided chats.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * ---------------------------------
 * Two things are shown side by side and they are not the same kind of thing.
 * The evidence — how many conversations, how many messages, how often the
 * assistant was unsure, and six things customers actually typed — was COUNTED,
 * row by row, in `src/lib/flows/suggest-prompt.ts`. The draft chat underneath
 * was WRITTEN BY A MODEL from those six examples and nothing else.
 *
 * So the two are separated visually and labelled as what they are. An owner
 * about to put words in front of their customers is entitled to know which
 * half they can check and which half they have to read. Nothing on this page
 * states a number a model produced, because no number here came from one.
 */
export default async function FlowSuggestionsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('flows'))) return <UpgradeNotice feature="flows" />;

  const [suggestions, counts, run] = await Promise.all([
    listFlowSuggestions(['new']),
    getFlowSuggestionCounts(),
    getLatestFlowSuggestionRun(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Questions worth a guided chat"
        description="We read the questions your own customers keep asking, count how often each one comes up, and draft a guided chat that answers it. Nothing goes live until you have read it and published it yourself."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/company/flows">All guided chats</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Waiting for you"
          value={counts.open}
          tone={counts.open > 0 ? 'info' : 'default'}
        />
        <StatTile
          label="Conversations behind them"
          value={formatNumber(counts.conversationsCovered)}
          hint="Counted, not estimated"
        />
        <StatTile label="Built" value={counts.accepted} tone={counts.accepted > 0 ? 'success' : 'default'} />
        <StatTile label="Dismissed" value={counts.dismissed} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">Look again</CardTitle>
            <CardDescription>{runDescription(run)}</CardDescription>
          </div>
          <GenerateFlowSuggestionsButton />
        </CardHeader>
      </Card>

      {suggestions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No suggestions yet"
              body="A question has to come up across several separate conversations before it is worth its own guided chat. This runs on its own once a week, and only on accounts with enough conversations for a repeat to mean anything."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/company/flows">Build one yourself</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} />
          ))}
        </div>
      )}
    </div>
  );
}

function runDescription(run: Awaited<ReturnType<typeof getLatestFlowSuggestionRun>>): string {
  if (!run) return 'This has not run yet. It also runs on its own once a week.';
  if (run.status === 'skipped') return run.note ?? 'Not enough conversations yet.';
  if (run.status === 'failed') return `The last attempt did not finish (${formatRelativeTime(run.createdAt)}).`;
  const found = `${run.topicsFound} repeated question${run.topicsFound === 1 ? '' : 's'} found`;
  const drafted = run.usedModel ? '' : ' — no AI key is configured, so nothing could be drafted';
  return `Last looked ${formatRelativeTime(run.createdAt)}: ${found}${drafted}.`;
}

function SuggestionCard({ suggestion }: { suggestion: FlowSuggestionRow }) {
  const conversations = suggestion.conversationCount;
  const messages = suggestion.questionCount;
  const unsure = suggestion.lowConfidenceCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {suggestion.keywords.map((keyword) => (
            <Badge key={keyword} variant="secondary">
              {keyword}
            </Badge>
          ))}
        </div>
        <CardTitle className="text-base">
          {formatNumber(conversations)} separate conversation{conversations === 1 ? '' : 's'} asked
          about this
        </CardTitle>
        <CardDescription>
          {formatDate(suggestion.periodStart)} to {formatDate(suggestion.periodEnd)}
          {unsure > 0
            ? ` · the assistant answered ${formatNumber(unsure)} of them without confidence`
            : ''}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* --- COUNTED ------------------------------------------------------ */}
        <section className="space-y-3 rounded-md bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">What was counted</p>
            <Badge variant="outline">From your conversations</Badge>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">
              <dt className="inline">Conversations: </dt>
              <dd className="inline font-medium text-foreground">{formatNumber(conversations)}</dd>
            </span>
            <span className="whitespace-nowrap">
              <dt className="inline">Messages: </dt>
              <dd className="inline font-medium text-foreground">{formatNumber(messages)}</dd>
            </span>
            <span className="whitespace-nowrap">
              <dt className="inline">Assistant unsure: </dt>
              <dd className="inline font-medium text-foreground">{formatNumber(unsure)}</dd>
            </span>
          </dl>

          <div>
            <p className="mb-1 text-sm font-medium">In their own words</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {suggestion.examples.map((example, i) => (
                <li key={i}>&ldquo;{example}&rdquo;</li>
              ))}
            </ul>
            {suggestion.examples.length < conversations ? (
              <p className="mt-1 text-xs text-muted-foreground">
                One example per conversation, up to six. The count above covers all of them.
              </p>
            ) : null}
          </div>
        </section>

        {/* --- DRAFTED ------------------------------------------------------ */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">The guided chat we drafted</p>
            <Badge variant="info">Written by AI</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            It does not know your prices, delivery areas or opening hours, so where a specific
            answer is needed it asks the customer and hands the turn to your assistant. Read it and
            change the wording before you publish.
          </p>
          <p className="text-sm">
            Name: <span className="font-medium">{suggestion.proposedName}</span>
          </p>
          <FlowSuggestionPreview graph={suggestion.proposedGraph} />
        </section>

        <div className="flex flex-wrap items-start gap-3 border-t pt-4">
          <AcceptFlowSuggestionForm suggestionId={suggestion.id} />
          <DismissFlowSuggestionForm suggestionId={suggestion.id} />
        </div>
      </CardContent>
    </Card>
  );
}
