import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Database, SearchCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { requireRole } from '@/lib/auth';
import { ROLES, labelFor } from '@/lib/constants';
import { companyLabel } from '@/lib/labels';
import { getQualityRoom } from '@/modules/company/suggestions-data';
import { listBots } from '@/modules/company/data';
import { listEvalQuestions } from '@/modules/company/eval-data';
import {
  getCompanyQualitySummary,
  getKnowledgeIndexSummary,
  listQualityFixes,
} from '@/modules/company/quality-data';
import { EvalForm } from '@/modules/company/components/eval-form';
import { QualityFeedbackForm } from '@/modules/company/components/quality-feedback-form';
import { TestAssistant } from '@/modules/company/components/test-assistant';

function formatCost(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Nothing saved yet';
  return new Date(value).toLocaleString();
}

/**
 * Where an answer came from.
 *
 * These are our retrieval buckets (`faq`, `policy`, `doc_chunk`,
 * `business_fact`). Which bucket answered is worth knowing — "it used a policy,
 * not the file you uploaded" is actionable — but only once the bucket has a name
 * an owner recognises.
 */
const SOURCE_LABELS: Record<string, string> = {
  faq: 'a saved question',
  policy: 'a policy',
  service: 'a service',
  location: 'a location',
  doc_chunk: 'a file you uploaded',
  document: 'a file you uploaded',
  business_fact: 'your business details',
  catalog: 'your product list',
  fix: 'a correction you made',
};

function sourceLabel(value: string) {
  return labelFor(SOURCE_LABELS, value);
}

/**
 * What went wrong with one answer.
 *
 * These are `answer_quality_logs.auto_audit_label` / `failure_reason` — our own
 * audit verdicts. They shared a hand-rolled title-caser with the fix types
 * below, which turned `no_answer` into the title-cased "No Answer" and told the
 * owner nothing they did not already know. Each one now says what actually
 * happened, so the badge is a diagnosis rather than an echo of the enum.
 */
const ANSWER_PROBLEM_LABELS: Record<string, string> = {
  missing_info: 'It had nothing saved to answer from',
  weak_retrieval: 'What it found did not really fit',
  no_answer: 'It did not answer at all',
  wrong_answer: 'It answered wrongly',
  hallucination_risk: 'It may have made this up',
  needs_human: 'Someone had to step in',
  human_needed: 'Someone had to step in',
  too_slow: 'It took too long to reply',
  tool_failed: 'A connected system did not respond',
  model_error: 'The assistant hit an error',
  bad_tone: 'The tone was wrong',
  low_csat: 'The customer rated this poorly',
  perfect: 'Answered well',
  acceptable: 'Good enough',
};

/**
 * The kind of correction that was saved.
 *
 * Deliberately a second map rather than a shared one: a fix type and an answer
 * problem are different questions ("what did you write?" vs "what went
 * wrong?"), and the one function that served both is why a fix type could
 * render as a failure and vice versa. Wording tracks the options in
 * `quality-feedback-form.tsx`, so the badge names the thing the owner picked.
 */
const FIX_TYPE_LABELS: Record<string, string> = {
  knowledge: 'Missing answer',
  faq: 'FAQ answer',
  policy: 'Policy or rule',
  service: 'Service or offer',
  profile: 'Business details',
  prompt: 'Assistant instruction',
};

function answerProblemLabel(value: string | null) {
  if (!value) return 'No issue';
  return labelFor(ANSWER_PROBLEM_LABELS, value);
}

function fixTypeLabel(value: string | null) {
  return labelFor(FIX_TYPE_LABELS, value, 'Correction');
}

export default async function CompanyQualityPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [room, bots, questions, summary, index, fixes] = await Promise.all([
    getQualityRoom(),
    listBots(),
    listEvalQuestions(),
    getCompanyQualitySummary(),
    getKnowledgeIndexSummary(),
    listQualityFixes(),
  ]);
  const pct = room.setupTotal ? Math.round((room.setupCompleted / room.setupTotal) * 100) : 0;
  const problemAnswers = summary.recent
    .filter(
      (row) =>
        row.failureReason ||
        row.autoAuditStatus === 'needs_review' ||
        row.autoAuditStatus === 'failed',
    )
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Improve answers"
        description="Every question your assistant handled badly, and a box to type the right answer into. Answer it once here and it answers it properly from then on."
        actions={
          <Button asChild variant="outline">
            <Link href="/company/business-data?tab=knowledge">
              <Database className="me-2 h-4 w-4" />
              Open my business info
            </Link>
          </Button>
        }
      />

      <TestAssistant />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Set-up finished</div>
            <div className="mt-2 text-3xl font-semibold">{pct}%</div>
            <Progress className="mt-3" value={pct} tone="success" label="Setup ready" />
            <p className="mt-2 text-xs text-muted-foreground">
              {room.setupCompleted} of {room.setupTotal} things done
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Facts it can search</div>
            <div className="mt-2 flex items-center gap-2 text-3xl font-semibold">
              {index.totalChunks}
              <SearchCheck className="h-6 w-6 text-success" />
            </div>
            {/* `totalChunks` above is a count of searchable passages, not of
                files — an owner reading "312" next to "documents" would think
                they had uploaded 312 files. The hint says which is which. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Searchable pieces, taken from {index.readyDocuments} finished{' '}
              {index.readyDocuments === 1 ? 'file' : 'files'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Answers worth a look</div>
            <div className="mt-2 text-3xl font-semibold">{summary.failed}</div>
            <p className="mt-2 text-xs text-muted-foreground">In the last 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">What answering cost you</div>
            <div className="mt-2 text-3xl font-semibold">{formatCost(summary.cost)}</div>
            <p className="mt-2 text-xs text-muted-foreground">Across the same 30 days</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-5 w-5 text-success" />
            Is it ready to search?
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="font-medium">How searching works</div>
            <p className="mt-1 text-muted-foreground">
              Your questions, policies, files and corrections are broken into small pieces so the
              assistant can find the right one by meaning, not just by matching words. That happens
              by itself when you save.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Last updated</div>
            <p className="mt-1 text-muted-foreground">{formatDate(index.lastIndexedAt)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Files we could not read</div>
            <p
              className={
                index.failedDocuments ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'
              }
            >
              {index.failedDocuments ? `${index.failedDocuments} need attention` : 'None'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Quality Room works</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use this area to improve answers without guessing where the fix should go.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="font-medium">1. Review weak answers</div>
            <p className="mt-1 text-muted-foreground">
              The page reads saved chat logs and quality flags. Loading this screen does not call
              the AI.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">2. Save the correct answer</div>
            <p className="mt-1 text-muted-foreground">
              Pick the fix type and write the exact business answer, policy, service detail, or
              instruction.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">3. Index for next time</div>
            <p className="mt-1 text-muted-foreground">
              When indexing is enabled, the fix is stored in Supabase as vector-search knowledge for
              future replies.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved fixes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Corrections stay editable in the proper business section. The original question is only
            context.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {fixes.length ? (
            fixes.map((fix) => (
              <div
                key={fix.id}
                className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{fixTypeLabel(fix.fixType)}</Badge>
                    <Badge variant={fix.chunksCreated > 0 ? 'success' : 'outline'}>
                      {fix.chunksCreated > 0 ? 'Searchable' : 'Saved, not searchable yet'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(fix.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="truncate text-sm font-medium">{fix.question}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{fix.correctionText}</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={fix.editHref}>Edit this fix</Link>
                </Button>
              </div>
            ))
          ) : (
            // Module 1 — no action to offer yet: fixes are created from the section below.
            <EmptyState
              title="You have not corrected anything yet"
              body="When you fix a weak answer below, we file the correction under the right part of your business info and list it here with a shortcut back to it."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Answers worth a look
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Real answers your assistant gave where it probably did not have what it needed. Type the
            right answer and it will use yours next time.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {problemAnswers.length ? (
            problemAnswers.map((item) => (
              <div key={item.id} className="space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">
                    {answerProblemLabel(item.autoAuditLabel ?? item.failureReason)}
                  </Badge>
                  {item.autoAuditScore == null ? null : (
                    <Badge variant="secondary">Scored {item.autoAuditScore} out of 100</Badge>
                  )}
                  {/* `sourceTypes` are retrieval buckets — `faq`, `policy`,
                      `doc_chunk`. Where the answer came from is genuinely useful
                      ("it used a policy, not a file"), so it stays; the badge
                      just says what the list is. */}
                  {item.sourceTypes.length ? (
                    <Badge variant="secondary">
                      Answered from: {item.sourceTypes.map((type) => sourceLabel(type)).join(', ')}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Nothing saved to answer from</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Customer asked
                    </div>
                    <p className="mt-2 text-sm">{item.question}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Assistant answered
                    </div>
                    <p className="mt-2 line-clamp-5 text-sm text-muted-foreground">{item.answer}</p>
                  </div>
                </div>
                {item.autoAuditReason || item.suggestedFix ? (
                  <Alert tone="warning" className="px-3 py-2">
                    {item.autoAuditReason ? <p>{item.autoAuditReason}</p> : null}
                    {item.suggestedFix ? (
                      <p className="mt-1 font-medium">{item.suggestedFix}</p>
                    ) : null}
                  </Alert>
                ) : null}
                <QualityFeedbackForm qualityLogId={item.id} />
              </div>
            ))
          ) : (
            // Module 2 — nothing to fix, so offer the way to prevent the next gap.
            <Alert
              tone="success"
              className="p-5"
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="No weak answers logged recently"
            >
              <p>
                When a customer asks something your assistant cannot answer well, the question lands
                here with the answer it gave, so you can correct it.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/company/business-data?tab=faqs">Add an FAQ instead</Link>
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Setup suggestions{' '}
              {room.suggestions.length ? (
                <Badge variant="secondary">{room.suggestions.length}</Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {room.suggestions.length === 0 ? (
              // Module 3 — the CTA used to live only in the populated branch; it belongs here too.
              <EmptyState
                title="Nothing to suggest right now."
                body="Your saved business facts cover the topics we check. New suggestions appear as customers ask about things you have not filled in."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/company/business-data">Review your business data</Link>
                  </Button>
                }
              />
            ) : (
              room.suggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.title}</span>
                      <Badge variant={s.impact === 'high' ? 'warning' : 'secondary'}>
                        {s.impact === 'high' ? 'High impact' : 'Medium'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link href={s.ctaHref}>{s.ctaLabel}</Link>
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test questions ({questions.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              Add common customer questions. This is cheap: it stores the question for later checks,
              it does not run AI now.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <EvalForm bots={bots} />
            {questions.length ? (
              <ul className="space-y-2">
                {questions.slice(0, 8).map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{q.question}</span>
                    {/* `EN`/`AR` is a code, not a language. Lower-cased first
                        because the map is keyed on the stored `en`/`ar`. */}
                    <Badge variant="secondary">
                      {companyLabel('language', q.language.toLowerCase())}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              // Module 4 — was rendering null under a heading; the form above is the action.
              <EmptyState
                title="No test questions saved yet."
                body="Saved questions show up in this list."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
