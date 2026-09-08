import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatNumber } from '@/lib/format';
import { chatProviderById } from '@/lib/ai/registry';
import { classifyModel, estimatedMonthlyCostGbp } from '@/lib/ai/model-policy';
import {
  MODEL_TIER_LABELS,
  PLANS,
  planModelTier,
  type PlanKey,
  type ModelTier,
} from '@/modules/super-admin/plans';

/**
 * What the model settings above actually cost, plan by plan.
 *
 * The models are chosen one card up, on a screen that says nothing about money,
 * and the difference between the two answers is the difference between a Pro
 * subscription keeping 76% of its price and keeping 15% of it. This table is
 * here so that choice is made with the arithmetic visible rather than after the
 * fact, in a month-end invoice nobody reconciles per plan.
 *
 * It is deliberately read-only. The tier a plan may reach is a pricing decision
 * that belongs in the code with the rest of the package (`features.premium_model`
 * in src/modules/super-admin/plans.ts), and the exception for one company
 * belongs on that company's own subscription, where the operator control for
 * every other feature exception already lives.
 */

/**
 * Costs are pence-scale and the difference between £2.42 and £8.40 is the whole
 * point, so these do not go through `formatCurrency` — it rounds to whole units.
 */
function gbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

function TierBadge({ tier }: { tier: ModelTier }) {
  return (
    <Badge variant={tier === 'premium' ? 'warning' : 'secondary'}>{MODEL_TIER_LABELS[tier]}</Badge>
  );
}

export function ModelPolicyCard({
  chatProvider,
  chatModel,
  advancedChatModel,
}: {
  chatProvider: string;
  chatModel: string;
  advancedChatModel: string;
}) {
  const def = chatProviderById(chatProvider);

  // Mirrors `getChatProviderAsync`: a model that is not on the selected
  // provider's list is not what gets sent, so it must not be what gets costed.
  const known = def ? [...def.models.latest, ...def.models.older] : [];
  const configured = known.includes(chatModel) ? chatModel : (def?.defaultChat ?? chatModel);

  // What each tier is actually answered on right now. A standard-tier plan is
  // clamped to the provider's everyday model whenever the configured one is
  // premium; a premium-tier plan can reach the escalation model on a hard
  // question, so that is the honest worst case to cost it at.
  const standardModel =
    classifyModel(configured) === 'premium' ? (def?.defaultChat ?? configured) : configured;
  const premiumModel =
    classifyModel(advancedChatModel) === 'premium' ? advancedChatModel : configured;

  const rows = (Object.keys(PLANS) as PlanKey[]).map((key) => {
    const plan = PLANS[key];
    const tier = planModelTier(key);
    const model = tier === 'premium' ? premiumModel : standardModel;
    const cost = estimatedMonthlyCostGbp(model, plan.messageLimit);
    return { key, plan, tier, model, cost };
  });

  const anyCosted = rows.some((r) => r.cost != null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Model Policy</CardTitle>
        <CardDescription>
          Which model each package is answered on, and what that costs against its price. The
          setting above is the platform&apos;s choice; a plan that may not reach the advanced tier
          is answered on the standard model instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Standard tier</p>
            <p className="mt-1 font-mono text-sm">{standardModel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every plan can be answered on this model. It is what a clamped reply falls back to,
              and what an unresolvable plan lookup uses.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Advanced tier</p>
            <p className="mt-1 font-mono text-sm">{premiumModel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Only plans marked <em>Advanced</em> below, plus any company granted the exception on
              its own subscription.
            </p>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Package</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Replies</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>AI cost at full use</TableHead>
              <TableHead>Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ key, plan, tier, model, cost }) => {
              const margin =
                cost != null && plan.priceMonthly > 0
                  ? Math.round(((plan.priceMonthly - cost) / plan.priceMonthly) * 100)
                  : null;
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium">{plan.label}</TableCell>
                  <TableCell>
                    {plan.priceMonthly > 0 ? formatCurrency(plan.priceMonthly, 'GBP') : '—'}
                  </TableCell>
                  <TableCell>
                    {plan.messageLimit == null ? 'Unmetered' : formatNumber(plan.messageLimit)}
                  </TableCell>
                  <TableCell>
                    <TierBadge tier={tier} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{model}</TableCell>
                  <TableCell>{cost == null ? '—' : gbp(cost)}</TableCell>
                  <TableCell>
                    {/* The thin-margin case is a badge rather than coloured text:
                        the semantic `-fg` tokens are contrast-checked against
                        their own `-bg`, not against the page. */}
                    {margin == null ? (
                      '—'
                    ) : margin < 30 ? (
                      <Badge variant="warning">{margin}%</Badge>
                    ) : (
                      <span>{margin}%</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            {anyCosted
              ? 'Cost is measured, not estimated: $0.00606 a reply on Claude Haiku and $0.02100 on Claude Sonnet, averaged over 89 production replies, converted at $1 = £0.80. A dash means we have no measurement for that model yet — only models we have actually billed appear with a number.'
              : 'No cost measurement exists for the models selected above. The figures we have are for Claude Haiku ($0.00606 a reply) and Claude Sonnet ($0.02100); anything else has to be measured before it can be costed here.'}
          </p>
          <p>
            A plan&apos;s tier is set by <code>features.premium_model</code> in{' '}
            <code>src/modules/super-admin/plans.ts</code>. One company can be moved off its
            package&apos;s answer — in either direction — from its subscription under Companies,
            using the <em>Advanced AI model</em> feature exception; no bespoke package is needed for
            a customer who negotiated the stronger model.
          </p>
          <p>
            If the plan cannot be established at all — no subscription row, or the lookup fails —
            the reply is sent on the standard model and the reason is logged. Answering on a cheaper
            model is a much smaller failure than not answering.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
