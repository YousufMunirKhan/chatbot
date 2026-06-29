import type { ToolSchema } from '@/lib/ai/types';
import type { AssistantTool, ToolContext } from './types';
import { productTools } from './products';
import { orderTools } from './orders';
import { leadTools } from './leads';
import { cartTools } from './cart';
import { helpdeskTools } from './helpdesk';
import { presenterTools } from './presenters';

export type { AssistantTool, ToolContext } from './types';

/** Full catalogue of tools (Modules 16–18 + leads/appointments + presenters). */
export const ALL_TOOLS: AssistantTool[] = [
  ...productTools,
  ...orderTools,
  ...leadTools,
  ...cartTools,
  ...helpdeskTools,
  ...presenterTools,
];

const BY_NAME: Record<string, AssistantTool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.schema.name, t]),
);

/** Tools enabled for a bot, based on its capability flags and audience. */
export function getToolsForBot(
  capabilityFlags: string[],
  assistantAudience: 'customer' | 'internal' = 'customer',
): AssistantTool[] {
  const caps = new Set(capabilityFlags);
  return ALL_TOOLS.filter((t) => {
    if (t.audiences && !t.audiences.includes(assistantAudience)) return false;
    return t.capabilities.some((c) => caps.has(c));
  });
}

export function getToolSchemas(
  capabilityFlags: string[],
  assistantAudience: 'customer' | 'internal' = 'customer',
): ToolSchema[] {
  return getToolsForBot(capabilityFlags, assistantAudience).map((t) => t.schema);
}

/** Execute a tool by name with input + context. Unknown tools return an error. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = BY_NAME[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Tool failed' };
  }
}
