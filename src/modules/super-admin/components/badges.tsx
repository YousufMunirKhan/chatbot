import { Badge } from '@/components/ui/badge';

export function CompanyStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'active' ? 'success' : 'destructive'}>
      {status === 'active' ? 'Active' : 'Suspended'}
    </Badge>
  );
}

export function SubStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const variant =
    status === 'active'
      ? 'success'
      : status === 'trialing'
        ? 'warning'
        : status === 'past_due'
          ? 'warning'
          : status === 'suspended' || status === 'canceled'
            ? 'destructive'
            : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}
