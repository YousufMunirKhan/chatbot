import type { ToolSchema } from '@/lib/ai/types';

/**
 * Tool layer types (Module 9 / 16 / 17 / 18). Tools are the only way the AI
 * touches business data: each validates input, scopes by companyId, and returns
 * structured results from the structured tables — never invented values.
 */
export interface ToolContext {
  companyId: string;
  botId: string | null;
  conversationId: string | null;
  language: string;
}

export interface AssistantTool {
  schema: ToolSchema;
  /** Bot capability flags that enable this tool. */
  capabilities: string[];
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function num(input: Record<string, unknown>, key: string, fallback = 0): number {
  const v = input[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
