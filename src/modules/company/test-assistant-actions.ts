'use server';

import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { previewAnswer } from '@/lib/ai/preview';
import { getCompanyId } from './data';

export type TestAssistantState = { answer?: string; question?: string; error?: string };

/** Live "Test your assistant" — returns the real answer, saves nothing. */
export async function testAssistantAction(
  _prev: TestAssistantState,
  formData: FormData,
): Promise<TestAssistantState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const question = String(formData.get('question') ?? '').trim();
  if (question.length < 3) return { error: 'Type a question to test.' };
  try {
    const { answer } = await previewAnswer({ companyId, question });
    return { answer, question };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not get an answer.' };
  }
}
