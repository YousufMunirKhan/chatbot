import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatCurrency } from '@/lib/format';
import { AiControlsForm } from '@/modules/company/components/ai-controls-form';
import { getAiControlsView } from '@/modules/company/ai-controls-data';

export default async function AiControlsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const controls = await getAiControlsView();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Cost Controls</h1>
        <p className="text-sm text-muted-foreground">Budget guardrails, provider fallback, and answer caching.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>This month</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-semibold">{formatCurrency(controls.costThisMonth)}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Controls</CardTitle></CardHeader>
        <CardContent>
          <AiControlsForm
            monthlyBudgetUsd={controls.monthlyBudgetUsd}
            hardStopEnabled={controls.hardStopEnabled}
            cacheEnabled={controls.cacheEnabled}
          />
        </CardContent>
      </Card>
    </div>
  );
}
