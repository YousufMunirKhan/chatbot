import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InfoBanner } from '@/components/info-banner';
import { formatDate, formatNumber } from '@/lib/format';
import { listBots } from '@/modules/company/data';
import { listDocuments } from '@/modules/company/knowledge-data';
import { deleteDocumentAction } from '@/modules/company/knowledge-actions';
import { KnowledgeForm } from '@/modules/company/components/knowledge-form';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'ready':
      return 'success';
    case 'processing':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export default async function KnowledgePage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [bots, docs] = await Promise.all([listBots(), listDocuments()]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground">
          Add your business content so your assistant can answer from it.
        </p>
      </div>

      <InfoBanner>
        Documents are embedded with a local mock model until an AI provider key is added (then re-add
        for higher-quality retrieval).
      </InfoBanner>

      <Card>
        <CardHeader>
          <CardTitle>Add text</CardTitle>
        </CardHeader>
        <CardContent>
          <KnowledgeForm bots={bots.map((b) => ({ id: b.id, name: b.name }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No knowledge yet. Add text above to train your assistant.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Assistant</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.title}</TableCell>
                    <TableCell>{d.botName ?? 'All'}</TableCell>
                    <TableCell>{d.sourceType}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                    </TableCell>
                    <TableCell>{formatNumber(d.charCount)} chars</TableCell>
                    <TableCell>{formatDate(d.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <form action={deleteDocumentAction}>
                        <input type="hidden" name="documentId" value={d.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Delete
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
