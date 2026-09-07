import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatCurrency } from '@/lib/format';
import { AiControlsForm } from '@/modules/company/components/ai-controls-form';
import { getAiControlsView } from '@/modules/company/ai-controls-data';

export default async function AiControlsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const controls = await getAiControlsView();
  return (
    // One number and one short form. Widening this to `max-w-6xl` gave a 1150px
    // column holding a single currency field — the page stays at a readable
    // measure, which is what the brief means by "forms stay narrow".
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Spending cap"
        description="What your assistant costs you to run, and the ceiling you want it to stop at. The sidebar calls this Spending cap; it is the same page."
      />

      <StatTile
        label="Spent so far this month"
        value={formatCurrency(controls.costThisMonth, 'USD')}
        hint="Resets on the first of each month. Only what your assistant spent on answering — it does not include your plan."
      />

      <Card>
        <CardHeader>
          <CardTitle>Your limit</CardTitle>
          <CardDescription>
            Set a ceiling so a busy month cannot surprise you. Leave it empty and there is no
            ceiling.
          </CardDescription>
        </CardHeader>
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
