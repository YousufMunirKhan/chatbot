import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface QuickActionAnalyticsRow {
  actionId: string | null;
  label: string;
  actionType: string;
  clicks: number;
  completed: number;
  conversionRate: number;
}

export async function getQuickActionAnalytics(): Promise<{
  totalClicks: number;
  totalCompleted: number;
  rows: QuickActionAnalyticsRow[];
}> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await sb
    .from('quick_action_clicks')
    .select('quick_action_id,action_type,completed_at,bot_quick_actions(label)')
    .eq('company_id', companyId)
    .gte('clicked_at', since.toISOString())
    .order('clicked_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const map = new Map<string, QuickActionAnalyticsRow>();
  for (const click of (data ?? []) as Array<Record<string, unknown>>) {
    const id = (click.quick_action_id as string | null) ?? null;
    const embedded = click.bot_quick_actions as { label?: string } | { label?: string }[] | null;
    const label = (Array.isArray(embedded) ? embedded[0]?.label : embedded?.label) ?? 'Deleted action';
    const key = id ?? `${label}:${click.action_type}`;
    const row =
      map.get(key) ??
      {
        actionId: id,
        label,
        actionType: (click.action_type as string) ?? 'unknown',
        clicks: 0,
        completed: 0,
        conversionRate: 0,
      };
    row.clicks++;
    if (click.completed_at) row.completed++;
    row.conversionRate = row.clicks ? Math.round((row.completed / row.clicks) * 100) : 0;
    map.set(key, row);
  }
  const rows = Array.from(map.values()).sort((a, b) => b.clicks - a.clicks);
  return {
    totalClicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    totalCompleted: rows.reduce((sum, row) => sum + row.completed, 0),
    rows,
  };
}
