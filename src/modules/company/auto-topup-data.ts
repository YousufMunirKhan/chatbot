import { createSupabaseServiceClient } from '@/lib/db/server';
import { mapAutoTopUpRow, type AutoTopUpAttempt, type AutoTopUpConfig } from '@/lib/billing/auto-topup';
import { getCompanyId } from './data';

/** Auto top-up settings + recent attempts for the company billing page. */
export async function getAutoTopUpSettings(): Promise<AutoTopUpConfig | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_auto_topup')
    .select(
      'company_id,is_enabled,threshold_credits,topup_amount_cents,stripe_payment_method_id,last_topup_at,failure_count,disabled_reason,claimed_at',
    )
    .eq('company_id', companyId)
    .maybeSingle();
  return data ? mapAutoTopUpRow(data as Record<string, unknown>) : null;
}

export async function listAutoTopUpAttempts(limit = 10): Promise<AutoTopUpAttempt[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_auto_topup_attempts')
    .select('id,status,amount_cents,balance_before,error,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    status: r.status as 'succeeded' | 'failed',
    amountCents: Number(r.amount_cents ?? 0),
    balanceBefore: r.balance_before == null ? null : Number(r.balance_before),
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Current prepaid AI credit balance, shown next to the threshold. */
export async function getCreditBalance(): Promise<number | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_credit_accounts')
    .select('balance_amount')
    .eq('company_id', companyId)
    .maybeSingle();
  return data ? Number((data as { balance_amount?: number }).balance_amount ?? 0) : null;
}
