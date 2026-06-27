import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startImpersonationAction } from '../impersonation-actions';

export function ImpersonationForm({ companyId }: { companyId: string }) {
  return (
    <form action={startImpersonationAction} className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" name="reason" required minLength={8} placeholder="Support ticket, billing issue, setup help..." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="durationMinutes">Minutes</Label>
        <Input id="durationMinutes" name="durationMinutes" type="number" min={5} max={120} defaultValue={60} />
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="destructive">View as admin</Button>
      </div>
    </form>
  );
}
