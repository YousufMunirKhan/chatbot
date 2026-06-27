import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { getPlatformQualitySummary, getPlatformEvalSummary } from '@/modules/super-admin/quality-data';
import { getPlatformImprovements, whereLabel } from '@/modules/super-admin/improvements-data';
import { emailImprovementsAction } from '@/modules/super-admin/actions';
import { Button } from '@/components/ui/button';

function money(v: number) {
  return `$${v.toFixed(4)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function SuperAdminQualityPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const [q, evals, improvements] = await Promise.all([
    getPlatformQualitySummary(),
    getPlatformEvalSummary(),
    getPlatformImprovements(),
  ]);
  const qualityScore = q.total ? Math.max(0, Math.round(((q.total - q.failed) / q.total) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform Quality</h1>
        <p className="text-sm text-muted-foreground">Cross-company answer quality, failure, and AI cost visibility.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Quality score" value={q.total ? `${qualityScore}%` : 'No data'} />
        <Stat label="Answers logged" value={formatNumber(q.total)} />
        <Stat label="Failed / weak" value={formatNumber(q.failed)} />
        <Stat label="AI cost" value={money(q.cost)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Worst-performing companies</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {q.companies.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Answers</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Cost</TableHead>
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
                      <TableCell>{money(c.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No quality logs yet.</p>
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
              <p className="text-sm text-muted-foreground">No failures logged yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assistant evaluation scores</CardTitle>
          <p className="text-sm text-muted-foreground">
            Latest LLM-graded evaluation run per company (answer quality, lowest first).
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {evals.length ? (
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
                {evals.map((e) => (
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
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No graded evaluation runs yet. Companies can run one from their Evaluation page.
            </p>
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
            <p className="text-sm text-muted-foreground">No companies yet.</p>
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
                      <li key={i} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
                        <span className="text-xs text-amber-900/70">“{s.question}” →</span>{' '}
                        <span className="font-medium text-amber-950">{s.fix}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {report.fixes.length === 0 && report.specificFixes.length === 0 ? (
                  <p className="text-sm text-emerald-700">Setup looks healthy — nothing to fix.</p>
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
