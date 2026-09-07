import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { formatStripeAmount, type CompanyInvoice } from '../billing-format';

/**
 * Invoice history — date, amount, status, and the PDF.
 *
 * The PDF is a link to the document Stripe already generates and hosts. This
 * app does not render, store, or proxy an invoice: Stripe's copy is the one
 * with the correct tax lines, the correct company details and the legal
 * numbering sequence, and a second copy produced here would eventually
 * disagree with it in front of an accountant.
 *
 * Stripe issues invoices for the subscription. One-off credit top-ups are
 * payment intents, not invoices, so they appear under "Automatic top-up"
 * instead — the caption says so rather than leaving somebody hunting for a
 * charge that was never going to be in this table.
 */

function statusVariant(status: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'paid') return 'success';
  if (status === 'open') return 'warning';
  if (status === 'uncollectible') return 'destructive';
  return 'secondary';
}

/** Stripe's own words, in the ones a customer uses. */
const STATUS_LABELS: Record<string, string> = {
  paid: 'Paid',
  open: 'Due',
  draft: 'Draft',
  void: 'Cancelled',
  uncollectible: 'Unpaid',
};

export function BillingInvoices({ invoices }: { invoices: CompanyInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        body="Stripe issues an invoice each time your package renews. The first one appears here after your first payment."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-end">Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="whitespace-nowrap">{formatDate(invoice.createdIso)}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {invoice.number ?? '—'}
              </TableCell>
              <TableCell className="font-medium">
                {formatStripeAmount(invoice.total, invoice.currency)}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(invoice.status)}>
                  {STATUS_LABELS[invoice.status] ?? invoice.status}
                </Badge>
              </TableCell>
              <TableCell className="text-end">
                {invoice.invoicePdfUrl ? (
                  <a
                    href={invoice.invoicePdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    PDF
                  </a>
                ) : invoice.hostedInvoiceUrl ? (
                  <a
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    View
                  </a>
                ) : (
                  // A draft invoice has neither link until Stripe finalises it.
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Invoices cover your monthly package. One-off credit top-ups are listed under Automatic
        top-up above.
      </p>
    </div>
  );
}
