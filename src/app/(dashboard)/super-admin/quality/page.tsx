import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { usd } from '@/modules/super-admin/money';
import { getPlatformQualitySummary, getPlatformEvalSummary, listAutoAuditIssues } from '@/modules/super-admin/quality-data';
import { getPlatformImprovements, whereLabel } from '@/modules/super-admin/improvements-data';
import { emailImprovementsAction } from '@/modules/super-admin/actions';
import { Button } from '@/components/ui/button';

export default async function SuperAdminQualityPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const [q, evals, improvements, auditIssues] = await Promise.all([
    getPlatformQualitySummary(),
    getPlatformEvalSummary(),
    getPlatformImprovements(),
    listAutoAuditIssues(),
  ]);
  const qualityScore = q.total ? Math.max(0, Math.round(((q.total - q.failed) / q.total) * 100)) : 0;
  const windowLabel = `last ${q.windowDays} days`;
  // The score and answer counts are exact over the window; the cost and the
  // per-company breakdown are computed from a capped row scan, so anything
  // derived from that scan says so rather than presenting a sample as a total.
  const sampleLabel = q.truncated
    ? `newest ${formatNumber(q.sampled)} of ${formatNumber(q.total)} answers`
    : windowLabel;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Quality"
        description="Cross-company answer quality, failure, and AI cost visibility."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Quality score" value={q.total ? `${qualityScore}%` : 'No data'} hint={windowLabel} />
        <StatTile label="Answers logged" value={formatNumber(q.total)} hint={windowLabel} />
        <StatTile label="Failed / weak" value={formatNumber(q.failed)} hint={windowLabel} />
        <StatTile label="AI cost (USD)" value={usd(q.cost)} hint={sampleLabel} />
      </div>

      {/*
        Not a warning: nothing is wrong and no action is required — it states
        which figures are exact and which are sampled. That is `info`.
      */}
      {q.truncated ? (
        <Alert tone="info" className="text-xs">
          {formatNumber(q.total)} answers were logged in the {windowLabel}, above the{' '}
          {formatNumber(q.sampleCap)}-row scan cap. The quality score, answer count, and failure
          count above are exact; the AI cost, the per-company table, and the failure-reason
          breakdown are computed from the newest {formatNumber(q.sampled)} answers only.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Worst-performing companies</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ranked by failures over the {sampleLabel}
              {q.companiesTruncated ? `, top ${q.companyCap} shown` : ''}.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {q.companies.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Answers</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Cost (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.companies.map((c) => (
                    <TableRow key={c.companyId}>
                      <TableCell className="font-medium">
                        <Link href={`/super-admin/companies/${c.companyId}`} className="text-primary hover:underline">
                          {c.companyName}
                        </Link>
                      </TableCell>
                      <TableCell>{formatNumber(c.total)}</TableCell>
                      <TableCell>
                        <Badge variant={c.failed ? 'warning' : 'success'}>{formatNumber(c.failed)}</Badge>
                      </TableCell>
                      <TableCell>{usd(c.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No quality logs yet." className="pt-0" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform failure reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {q.failures.length ? (
              <div className="space-y-2">
                {q.failures.map((f) => (
                  <div key={f.reason} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span>{f.reason.replace(/_/g, ' ')}</span>
                    <Badge variant="warning">{f.count}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No failures logged yet." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Auto-audit queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            New AI answers marked failed or needs review. Open the transcript, then approve the fix in the company&apos;s Quality Room.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditIssues.length === 0 ? (
            <EmptyState title="No auto-audit issues waiting." />
          ) : (
            auditIssues.map((issue) => (
              <div key={issue.id} className="rounded-lg border p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link href={`/super-admin/companies/${issue.companyId}`} className="font-medium text-primary hover:underline">
                    {issue.companyName}
                  </Link>
                  <Badge variant={issue.status === 'failed' ? 'destructive' : 'warning'}>{issue.status.replace(/_/g, ' ')}</Badge>
                  {issue.label ? <Badge variant="secondary">{issue.label.replace(/_/g, ' ')}</Badge> : null}
                  {issue.score == null ? null : <span className="text-xs text-muted-foreground">{issue.score}%</span>}
                </div>
                <p className="line-clamp-2 text-sm font-medium">{issue.question}</p>
                {issue.reason ? <p className="mt-1 text-sm text-muted-foreground">{issue.reason}</p> : null}
                {issue.suggestedFix ? (
                  <Alert tone="warning" className="mt-2 p-2">
                    {issue.suggestedFix}
                  </Alert>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {issue.conversationId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/super-admin/chat-logs/${issue.conversationId}`}>Open transcript</Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/super-admin/companies/${issue.companyId}?tab=quality`}>Company quality</Link>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assistant evaluation scores</CardTitle>
          <p className="text-sm text-muted-foreground">
            Latest LLM-graded evaluation run per company (answer quality, lowest first).
            {evals.companiesTruncated
              ? ` Lowest ${evals.companyCap} of ${formatNumber(evals.companiesFound)} companies with a graded run.`
              : ''}
            {evals.scanTruncated
              ? ` Scan capped at the newest ${formatNumber(evals.scanCap)} graded runs — a company that has not evaluated recently may be missing.`
              : ''}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {evals.rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Answer quality</TableHead>
                  <TableHead>Passed</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evals.rows.map((e) => (
                  <TableRow key={e.companyId}>
                    <TableCell className="font-medium">
                      <Link href={`/super-admin/companies/${e.companyId}`} className="text-primary hover:underline">
                        {e.companyName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {e.avgAnswerScore == null ? (
                        '—'
                      ) : (
                        <Badge variant={e.avgAnswerScore >= 70 ? 'success' : 'warning'}>{e.avgAnswerScore}%</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatNumber(e.passed)}/{formatNumber(e.total)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No graded evaluation runs yet. Companies can run one from their Evaluation page."
              className="pt-0"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each company should improve</CardTitle>
          <p className="text-sm text-muted-foreground">
            The exact data to add, where to add it, and the impact. Email a company its full report with one click.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {improvements.length === 0 ? (
            <EmptyState title="No companies yet." />
          ) : (
            improvements.map((report) => (
              <div key={report.companyId} className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/super-admin/companies/${report.companyId}`} className="font-medium text-primary hover:underline">
                      {report.companyName}
                    </Link>
                    {report.answerQuality != null ? (
                      <Badge variant={report.answerQuality >= 70 ? 'success' : 'warning'}>{report.answerQuality}% quality</Badge>
                    ) : (
                      <Badge variant="secondary">Not evaluated</Badge>
                    )}
                    {report.setupTotal > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        setup {report.setupCompleted}/{report.setupTotal}
                      </span>
                    ) : null}
                  </div>
                  <form action={emailImprovementsAction}>
                    <input type="hidden" name="companyId" value={report.companyId} />
                    <Button type="submit" variant="outline" size="sm">Email company</Button>
                  </form>
                </div>
                {report.specificFixes.length ? (
                  <ul className="mb-3 space-y-2">
                    {report.specificFixes.slice(0, 5).map((s, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-warning-border bg-warning-bg p-2 text-sm"
                      >
                        <span className="text-xs text-warning-fg/70">“{s.question}” →</span>{' '}
                        <span className="font-medium text-warning-fg">{s.fix}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {report.fixes.length === 0 && report.specificFixes.length === 0 ? (
                  <p className="text-sm text-success-fg">Setup looks healthy — nothing to fix.</p>
                ) : report.fixes.length ? (
                  <ul className="space-y-2">
                    {report.fixes.slice(0, 5).map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant={f.impact === 'high' ? 'warning' : 'secondary'}>
                          {f.impact === 'high' ? 'High' : 'Medium'}
                        </Badge>
                        <span className="font-medium">{f.title}</span>
                        <span className="text-muted-foreground">→ {whereLabel(f.ctaHref)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
