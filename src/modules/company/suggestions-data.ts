import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Improvement suggestions engine (company-facing "Quality Room").
 *
 * Turns internal quality signals into POSITIVE, actionable to-dos — "add this
 * data to improve results" — instead of a score. Every signal comes from data
 * already in the database (profile completeness, knowledge/products coverage,
 * and real questions the assistant couldn't answer). Raw quality scores stay
 * super-admin only.
 */
export type Impact = 'high' | 'medium';

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  impact: Impact;
  ctaLabel: string;
  ctaHref: string;
}

export interface QualityRoom {
  setupCompleted: number;
  setupTotal: number;
  suggestions: Suggestion[];
  completed: string[];
}

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function getQualityRoom(): Promise<QualityRoom> {
  return computeQualityRoom(await getCompanyId());
}

/** Same as getQualityRoom but for any company (used by super-admin reports). */
export async function computeQualityRoom(companyId: string): Promise<QualityRoom> {
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [profileRes, hoursRes, policiesRes, faqsRes, productsRes, integrationsRes, docsRes, botsRes, evalQRes, failuresRes] =
    await Promise.all([
      sb.from('company_business_profiles').select('short_description,primary_phone,support_email,whatsapp').eq('company_id', companyId).maybeSingle(),
      sb.from('company_business_hours').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      sb.from('company_policies').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_active', true),
      sb.from('company_faqs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_active', true),
      sb.from('synced_products').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      sb.from('integration_accounts').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'connected'),
      sb.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'ready'),
      sb.from('bots').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('ai_enabled', true),
      sb.from('eval_questions').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      sb
        .from('answer_quality_logs')
        .select('question,failure_reason')
        .eq('company_id', companyId)
        .in('failure_reason', ['missing_info', 'weak_retrieval'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

  const profile = (profileRes.data ?? {}) as Record<string, unknown>;
  const hasDescription = Boolean((profile.short_description as string)?.trim());
  const hasContact = Boolean((profile.primary_phone as string)?.trim() || (profile.support_email as string)?.trim() || (profile.whatsapp as string)?.trim());
  const hasHours = (hoursRes.count ?? 0) > 0;
  const hasPolicy = (policiesRes.count ?? 0) > 0;
  const hasFaq = (faqsRes.count ?? 0) > 0;
  const hasProducts = (productsRes.count ?? 0) > 0;
  const hasIntegration = (integrationsRes.count ?? 0) > 0;
  const hasDocs = (docsRes.count ?? 0) > 0;
  const hasActiveBot = (botsRes.count ?? 0) > 0;
  const hasEvalQuestions = (evalQRes.count ?? 0) > 0;

  // Setup checklist (drives the progress bar — a to-do count, not a score).
  const checklist: Array<{ done: boolean; label: string }> = [
    { done: hasDescription, label: 'Business description added' },
    { done: hasContact, label: 'Contact details added' },
    { done: hasHours, label: 'Business hours added' },
    { done: hasPolicy, label: 'A policy added (returns, shipping…)' },
    { done: hasDocs, label: 'Knowledge documents uploaded' },
    { done: hasFaq, label: 'FAQs added' },
    { done: hasActiveBot, label: 'An assistant is live' },
    { done: hasEvalQuestions, label: 'Sample questions added' },
    { done: hasProducts || hasIntegration, label: 'Products connected' },
  ];
  const setupCompleted = checklist.filter((c) => c.done).length;
  const setupTotal = checklist.length;
  const completed = checklist.filter((c) => c.done).map((c) => c.label);

  const suggestions: Suggestion[] = [];

  if (!hasContact) {
    suggestions.push({
      id: 'contact',
      title: 'Add your contact details',
      description: 'Customers ask how to reach you. Add a phone, WhatsApp, or support email so the assistant can share it.',
      impact: 'high',
      ctaLabel: 'Edit profile',
      ctaHref: '/company/profile',
    });
  }
  if (!hasHours) {
    suggestions.push({
      id: 'hours',
      title: 'Add your business hours',
      description: 'Without opening hours the assistant can’t answer “are you open?” reliably.',
      impact: 'high',
      ctaLabel: 'Edit profile',
      ctaHref: '/company/profile',
    });
  }
  if (!hasPolicy) {
    suggestions.push({
      id: 'policy',
      title: 'Add your policies',
      description: 'Add returns, shipping, and refund policies so the assistant can answer them accurately.',
      impact: 'high',
      ctaLabel: 'Add policy',
      ctaHref: '/company/profile',
    });
  }
  if (!hasDocs && !hasFaq) {
    suggestions.push({
      id: 'knowledge',
      title: 'Upload your knowledge',
      description: 'Add FAQs or documents (policies, guides) so the assistant answers from your real content.',
      impact: 'high',
      ctaLabel: 'Add knowledge',
      ctaHref: '/company/knowledge',
    });
  }
  if (!hasProducts && !hasIntegration) {
    suggestions.push({
      id: 'products',
      title: 'Connect your store',
      description: 'No products are synced, so the assistant can’t answer price, stock, or order questions yet.',
      impact: 'high',
      ctaLabel: 'Connect',
      ctaHref: '/company/integrations',
    });
  }

  // Real customer questions the assistant couldn't answer → "add this".
  const failures = (failuresRes.data ?? []) as Array<{ question?: string }>;
  const counts = new Map<string, { question: string; count: number }>();
  for (const f of failures) {
    const raw = (f.question ?? '').trim();
    if (raw.length < 5) continue;
    const key = normalize(raw);
    const entry = counts.get(key) ?? { question: raw, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const topGaps = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  for (const gap of topGaps) {
    suggestions.push({
      id: `gap:${normalize(gap.question).slice(0, 40)}`,
      title: `Answer “${gap.question.length > 70 ? gap.question.slice(0, 67) + '…' : gap.question}”`,
      description:
        gap.count > 1
          ? `Asked ${gap.count} times in the last 30 days with no matching knowledge.`
          : 'A customer asked this and the assistant had no matching knowledge.',
      impact: gap.count >= 3 ? 'high' : 'medium',
      ctaLabel: 'Add knowledge',
      ctaHref: '/company/knowledge',
    });
  }

  if (!hasEvalQuestions) {
    suggestions.push({
      id: 'samples',
      title: 'Add sample questions',
      description: 'Add the questions your customers ask most so you can check the assistant is ready to answer them.',
      impact: 'medium',
      ctaLabel: 'Add questions',
      ctaHref: '/company/quality',
    });
  }

  // High impact first.
  suggestions.sort((a, b) => (a.impact === b.impact ? 0 : a.impact === 'high' ? -1 : 1));

  return { setupCompleted, setupTotal, suggestions, completed };
}
