'use client';

import { useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { cn } from '@/lib/utils';
import { COUNTRY_OPTIONS } from '@/modules/company/form-options';
import { createCompanyAction, type ActionState } from '../actions';
import { PLANS, PLAN_KEYS, type PlanKey } from '../plans';

const initial: ActionState = {};

function limitText(value: number | null) {
  return value == null ? 'Unlimited' : value.toLocaleString();
}

function priceLabel(planKey: PlanKey, value: number, currency = '£') {
  if (planKey === 'custom') return 'Custom';
  if (value === 0) return 'Free';
  return `${currency}${value.toLocaleString()}`;
}

export function CompanyForm() {
  const [state, action] = useFormState(createCompanyAction, initial);
  const [companyName, setCompanyName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [planKey, setPlanKey] = useState<PlanKey>('free_trial');
  const [messageLimit, setMessageLimit] = useState('');
  const [agentLimit, setAgentLimit] = useState('');
  const [botLimit, setBotLimit] = useState('');
  const [integrationLimit, setIntegrationLimit] = useState('');
  const [monthlyAiBudgetUsd, setMonthlyAiBudgetUsd] = useState('');
  const [hardStopEnabled, setHardStopEnabled] = useState(true);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [initialCreditAmount, setInitialCreditAmount] = useState('');
  const [setupFeeAmount, setSetupFeeAmount] = useState('');
  const [apiWebhookAddon, setApiWebhookAddon] = useState(false);

  const selectedPlan = PLANS[planKey];
  const effective = useMemo(
    () => ({
      messages: messageLimit || limitText(selectedPlan.messageLimit),
      agents: agentLimit || limitText(selectedPlan.agentLimit),
      assistants: botLimit || limitText(selectedPlan.botLimit),
      integrations: integrationLimit || limitText(selectedPlan.integrationLimit),
    }),
    [agentLimit, botLimit, integrationLimit, messageLimit, selectedPlan],
  );

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Step 1
              </p>
              <h2 className="mt-1 text-lg font-semibold">Company profile</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create the tenant and set the default customer language.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Company name *" htmlFor="name">
              <Input
                id="name"
                name="name"
                required
                placeholder="Acme Restaurants"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </FormField>
            <FormField label="Website" htmlFor="website">
              <Input id="website" name="website" type="url" placeholder="https://acme.com" />
            </FormField>
            <FormField label="Country" htmlFor="country">
              <Select id="country" name="country" defaultValue="GB">
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.value} value={country.value}>
                    {country.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Default language" htmlFor="defaultLanguage">
              <Select id="defaultLanguage" name="defaultLanguage" defaultValue="auto">
                <option value="auto">Auto-detect</option>
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </Select>
            </FormField>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 2
            </p>
            <h2 className="mt-1 text-lg font-semibold">Company admin login</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This user becomes the first company admin and can finish setup.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Admin name" htmlFor="adminName">
              <Input id="adminName" name="adminName" placeholder="Jane Doe" />
            </FormField>
            <FormField label="Admin email *" htmlFor="adminEmail">
              <Input
                id="adminEmail"
                name="adminEmail"
                type="email"
                required
                placeholder="admin@acme.com"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Temporary password *" htmlFor="adminPassword">
              <Input
                id="adminPassword"
                name="adminPassword"
                type="password"
                required
                minLength={8}
                placeholder="min. 8 characters"
              />
            </FormField>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 3
            </p>
            <h2 className="mt-1 text-lg font-semibold">Plan and commercial limits</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the starting package and override limits only when you have agreed a custom
              deal.
            </p>
          </div>

          <input type="hidden" name="plan" value={planKey} />
          <div className="grid gap-3 lg:grid-cols-5">
            {PLAN_KEYS.map((key) => {
              const plan = PLANS[key];
              const selected = key === planKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlanKey(key)}
                  className={cn(
                    'rounded-lg border p-3 text-start transition-colors',
                    selected ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-primary/50',
                  )}
                >
                  <span className="block text-sm font-semibold">{plan.label}</span>
                  <span className="mt-1 block text-xl font-semibold">
                    {priceLabel(key, plan.priceMonthly)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">per month</span>
                  <span className="mt-3 block text-xs text-muted-foreground">
                    {plan.description}
                  </span>
                  <span className="mt-2 block text-xs font-medium text-success-fg">
                    £{plan.includedCreditGbp.toLocaleString()} AI credit included
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormField label="Free until" htmlFor="freeUntil">
              <Input id="freeUntil" name="freeUntil" type="date" />
            </FormField>
            <FormField label="Messages" htmlFor="messageLimit">
              <Input
                id="messageLimit"
                name="messageLimit"
                type="number"
                min={0}
                placeholder={limitText(selectedPlan.messageLimit)}
                value={messageLimit}
                onChange={(event) => setMessageLimit(event.target.value)}
              />
            </FormField>
            <FormField label="Assistants" htmlFor="botLimit">
              <Input
                id="botLimit"
                name="botLimit"
                type="number"
                min={0}
                placeholder={limitText(selectedPlan.botLimit)}
                value={botLimit}
                onChange={(event) => setBotLimit(event.target.value)}
              />
            </FormField>
            <FormField label="Team seats" htmlFor="agentLimit">
              <Input
                id="agentLimit"
                name="agentLimit"
                type="number"
                min={0}
                placeholder={limitText(selectedPlan.agentLimit)}
                value={agentLimit}
                onChange={(event) => setAgentLimit(event.target.value)}
              />
            </FormField>
            <FormField label="Integrations" htmlFor="integrationLimit">
              <Input
                id="integrationLimit"
                name="integrationLimit"
                type="number"
                min={0}
                placeholder={limitText(selectedPlan.integrationLimit)}
                value={integrationLimit}
                onChange={(event) => setIntegrationLimit(event.target.value)}
              />
            </FormField>
          </div>

          <p className="mt-4 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">How limits are read:</strong> a number is
            used exactly as typed (<code>0</code> is a valid limit and blocks the feature). Leave a
            box blank to use the plan default shown in the placeholder — the same rule the
            company&apos;s Plan &amp; limits tab uses. To remove a cap entirely, pick the Custom plan
            or tick <em>Unlimited</em> on that tab after onboarding.
          </p>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 4
            </p>
            <h2 className="mt-1 text-lg font-semibold">AI cost controls</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Protect platform margin before the company starts sending messages.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Monthly AI budget cap (USD)"
              htmlFor="monthlyAiBudgetUsd"
              hint="This is your internal AI cost cap, not customer credit."
            >
              <Input
                id="monthlyAiBudgetUsd"
                name="monthlyAiBudgetUsd"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 10"
                value={monthlyAiBudgetUsd}
                onChange={(event) => setMonthlyAiBudgetUsd(event.target.value)}
              />
            </FormField>
          </div>

          {/*
            The "Allow paid overage" checkbox and its unit-price input were
            removed: they wrote `subscriptions.overage_enabled` /
            `overage_unit_price`, which nothing in plan enforcement reads, so the
            controls promised a billing policy that never applied. Reinstate them
            together with real enforcement in the billing layer.
          */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="hardStopEnabled"
                checked={hardStopEnabled}
                onChange={(event) => setHardStopEnabled(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Hard stop AI at budget</span>
                <span className="text-xs text-muted-foreground">
                  Prevents surprise OpenAI/provider cost.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="cacheEnabled"
                checked={cacheEnabled}
                onChange={(event) => setCacheEnabled(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Cache safe answers</span>
                <span className="text-xs text-muted-foreground">
                  Reduces repeated AI calls for simple questions.
                </span>
              </span>
            </label>
          </div>
          {!cacheEnabled ? <input type="hidden" name="cacheEnabled" value="off" /> : null}
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 5
            </p>
            <h2 className="mt-1 text-lg font-semibold">Credit, add-ons, and data terms</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the customer wallet and confirm they understand how uploaded business data is
              processed.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              label="Starting AI credit (£)"
              htmlFor="initialCreditAmount"
              hint="Leave blank to use the plan included credit."
            >
              <Input
                id="initialCreditAmount"
                name="initialCreditAmount"
                type="number"
                min={0}
                step="0.01"
                placeholder={selectedPlan.includedCreditGbp.toString()}
                value={initialCreditAmount}
                onChange={(event) => setInitialCreditAmount(event.target.value)}
              />
            </FormField>
            <FormField label="Setup fee (£)" htmlFor="setupFeeAmount">
              <Input
                id="setupFeeAmount"
                name="setupFeeAmount"
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                value={setupFeeAmount}
                onChange={(event) => setSetupFeeAmount(event.target.value)}
              />
            </FormField>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="apiWebhookAddon"
                checked={apiWebhookAddon}
                onChange={(event) => setApiWebhookAddon(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-medium">API and webhooks add-on</span>
                <span className="text-xs text-muted-foreground">
                  £10/month for system integrations.
                </span>
              </span>
            </label>
          </div>

          {/*
            A consent gate, not a standing notice — the amber surface has to be
            the clickable `<label>` itself, so this takes the `warning` triplet
            directly rather than wrapping an `Alert` (which is a plain div and
            would put the tint on the wrong element).
          */}
          <label className="mt-4 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
            <input type="checkbox" name="privacyAcknowledged" required className="mt-1 h-4 w-4" />
            <span>
              <span className="block font-medium text-warning-fg">
                Privacy and data processing confirmed
              </span>
              <span className="text-xs text-warning-fg">
                The customer has been told to upload only data they have permission to use, and has
                access to the
                <a href="/privacy" className="mx-1 font-medium underline" target="_blank">
                  Privacy Policy
                </a>
                and
                <a href="/data-processing" className="ms-1 font-medium underline" target="_blank">
                  Data Processing Notice
                </a>
                before any business data or files are added.
              </span>
            </span>
          </label>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Launch summary
          </p>
          <h2 className="mt-2 text-xl font-semibold">{companyName || 'New company'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {adminEmail || 'Admin email not set'}
          </p>

          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium">{selectedPlan.label}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Monthly</span>
              <span className="font-medium">{priceLabel(planKey, selectedPlan.priceMonthly)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Messages</span>
              <span className="font-medium">{effective.messages}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Assistants</span>
              <span className="font-medium">{effective.assistants}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Team seats</span>
              <span className="font-medium">{effective.agents}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Integrations</span>
              <span className="font-medium">{effective.integrations}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">AI budget cap</span>
              <span className="font-medium">
                {monthlyAiBudgetUsd ? `$${monthlyAiBudgetUsd}` : 'Not set'}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Customer AI credit</span>
              <span className="font-medium">
                £{initialCreditAmount || selectedPlan.includedCreditGbp.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Setup fee</span>
              <span className="font-medium">{setupFeeAmount ? `£${setupFeeAmount}` : 'None'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">API/webhooks</span>
              <span className="font-medium">{apiWebhookAddon ? '£10/month' : 'Off'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Budget action</span>
              <span className="font-medium">{hardStopEnabled ? 'Hard stop' : 'Warn only'}</span>
            </div>
          </div>

          <div className="mt-5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Customer credit is charged from the wallet. Internal AI budget is your platform cost
            guardrail.
          </div>

          <FormMessage state={state} className="mt-4" />
          <div className="mt-5">
            <SubmitButton size="lg" className="w-full" pendingLabel="Creating company...">
              Create company and admin login
            </SubmitButton>
          </div>
        </div>
      </aside>
    </form>
  );
}
