import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Database, SearchCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getQualityRoom } from '@/modules/company/suggestions-data';
import { listBots } from '@/modules/company/data';
import { listEvalQuestions } from '@/modules/company/eval-data';
import { getCompanyQualitySummary, getKnowledgeIndexSummary, listQualityFixes } from '@/modules/company/quality-data';
import { EvalForm } from '@/modules/company/components/eval-form';
import { QualityFeedbackForm } from '@/modules/company/components/quality-feedback-form';
import { TestAssistant } from '@/modules/company/components/test-assistant';

function formatCost(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Not indexed yet';
  return new Date(value).toLocaleString();
}

function reasonLabel(value: string | null) {
  if (!value) return 'No issue';
  return value
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
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
  const problemAnswers = summary.recent.filter((row) => row.failureReason).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Quality Room</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review weak answers, add the missing business knowledge, and confirm it is indexed for AI search.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/company/knowledge">
            <Database className="mr-2 h-4 w-4" />
            Open knowledge base
          </Link>
        </Button>
      </div>

      <TestAssistant />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Setup ready</div>
            <div className="mt-2 text-3xl font-semibold">{pct}%</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{room.setupCompleted} of {room.setupTotal} items complete</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">AI-search index</div>
            <div className="mt-2 flex items-center gap-2 text-3xl font-semibold">
              {index.totalChunks}
              <SearchCheck className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{index.readyDocuments} ready documents</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Issues found</div>
            <div className="mt-2 text-3xl font-semibold">{summary.failed}</div>
            <p className="mt-2 text-xs text-muted-foreground">Last 30 days, no extra AI calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">AI spend checked</div>
            <div className="mt-2 text-3xl font-semibold">{formatCost(summary.cost)}</div>
            <p className="mt-2 text-xs text-muted-foreground">From logged chat usage</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-5 w-5 text-emerald-500" />
            Knowledge indexing status
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="font-medium">Vector search</div>
            <p className="mt-1 text-muted-foreground">
              FAQs, policies, documents, and fixes are saved as chunks with embeddings in Supabase.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Last indexed</div>
            <p className="mt-1 text-muted-foreground">{formatDate(index.lastIndexedAt)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Failed documents</div>
            <p className={index.failedDocuments ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'}>
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
              The page reads saved chat logs and quality flags. Loading this screen does not call the AI.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">2. Save the correct answer</div>
            <p className="mt-1 text-muted-foreground">
              Pick the fix type and write the exact business answer, policy, service detail, or instruction.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">3. Index for next time</div>
            <p className="mt-1 text-muted-foreground">
              When indexing is enabled, the fix is stored in Supabase as vector-search knowledge for future replies.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved fixes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Corrections stay editable in the proper business section. The original question is only context.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {fixes.length ? (
            fixes.map((fix) => (
              <div key={fix.id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{reasonLabel(fix.fixType)}</Badge>
                    <Badge variant={fix.chunksCreated > 0 ? 'success' : 'outline'}>
                      {fix.chunksCreated > 0 ? `${fix.chunksCreated} chunks indexed` : 'Structured only'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(fix.createdAt).toLocaleString()}</span>
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
            <p className="text-sm text-muted-foreground">
              No fixes saved yet. When you correct a weak answer, it will appear here with an edit shortcut.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Fix weak answers
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These are real logged answers where the assistant likely lacked knowledge or retrieval was weak.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {problemAnswers.length ? (
            problemAnswers.map((item) => (
              <div key={item.id} className="space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{reasonLabel(item.failureReason)}</Badge>
                  {item.sourceTypes.length ? <Badge variant="secondary">{item.sourceTypes.join(', ')}</Badge> : null}
                  <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer asked</div>
                    <p className="mt-2 text-sm">{item.question}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assistant answered</div>
                    <p className="mt-2 line-clamp-5 text-sm text-muted-foreground">{item.answer}</p>
                  </div>
                </div>
                <QualityFeedbackForm qualityLogId={item.id} />
              </div>
            ))
          ) : (
            <div className="rounded-xl border bg-emerald-50 p-5 text-sm text-emerald-800">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                No weak answers logged recently
              </div>
              <p className="mt-1">When a customer question has missing knowledge, it will appear here for correction.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Setup suggestions {room.suggestions.length ? <Badge variant="secondary">{room.suggestions.length}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {room.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Your assistant setup looks healthy. New suggestions will appear as customers chat.</p>
            ) : (
              room.suggestions.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
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
              Add common customer questions. This is cheap: it stores the question for later checks, it does not run AI now.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <EvalForm bots={bots} />
            {questions.length ? (
              <ul className="space-y-2">
                {questions.slice(0, 8).map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                    <span className="min-w-0 truncate">{q.question}</span>
                    <Badge variant="secondary">{q.language.toUpperCase()}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
