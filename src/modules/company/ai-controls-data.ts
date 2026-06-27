import { getAiBudget, getMonthlyAiCost } from '@/lib/ai/cost-controls';
import { getCompanyId } from './data';

export async function getAiControlsView() {
  const companyId = await getCompanyId();
  const [budget, cost] = await Promise.all([getAiBudget(companyId), getMonthlyAiCost(companyId)]);
  return { ...budget, costThisMonth: cost };
}
