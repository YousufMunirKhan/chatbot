import type { ChatMessage, ToolSchema } from '@/lib/ai/types';
import { CACHE_BREAKPOINT } from '@/lib/ai/types';
import { executeTool, type ToolContext } from '@/lib/tools';
import { fetchWithRetry } from '@/lib/ai/http';
import { normalizeAnthropicTurns } from '@/lib/ai/providers/anthropic';

/**
 * Provider-agnostic tool-calling loop (Issues #1 + #19).
 *
 * Both OpenAI and Anthropic run a real agentic loop: the model calls tools
 * (products / orders / leads / cart / appointments), we execute them against
 * structured data, feed results back, and repeat until it produces a final
 * answer — which is streamed token-by-token to the widget (no fake chunking).
 *
 * Anthropic is no longer crippled: picking it as the provider keeps full tool
 * use. Mock has no tools and uses the plain streaming path in the route.
 */
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_STEPS = 5;
const MAX_TOOL_RESULT_CHARS = 6000;

export interface ToolLoopParams {
  providerName: 'openai' | 'anthropic';
  /** OpenAI-compatible base URL (OpenAI / DeepSeek / xAI Grok). */
  baseUrl?: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  ctx: ToolContext;
  /** Stream final-answer tokens to the caller as they arrive. */
  onToken?: (token: string) => void;
  /** Fired when a tool is about to run — used to show live status to the user. */
  onToolStart?: (name: string) => void;
  /**
   * Fired when a tool returns a UI directive (a `__action` marker) — e.g. a
   * presenter tool asking the widget to render a lead form or product cards.
   */
  onAction?: (action: string, payload: unknown) => void;
  signal?: AbortSignal;
  temperature?: number;
}

export interface ToolLoopResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolsCalled: string[];
}

function clampToolResult(result: unknown): string {
  const s = JSON.stringify(result ?? {});
  return s.length > MAX_TOOL_RESULT_CHARS ? s.slice(0, MAX_TOOL_RESULT_CHARS) + '…"truncated":true}' : s;
}

/**
 * A presenter tool returns a `__action` marker to drive the widget UI (render a
 * form, product cards, etc.). Pull it out, fire onAction, and hand the model
 * back only the plain part of the result so it isn't confused by the directive.
 */
function extractAction(result: unknown, onAction?: ToolLoopParams['onAction']): unknown {
  if (!result || typeof result !== 'object' || !('__action' in result)) return result;
  const { __action, ...rest } = result as { __action?: unknown } & Record<string, unknown>;
  if (
    __action &&
    typeof __action === 'object' &&
    typeof (__action as { action?: unknown }).action === 'string'
  ) {
    const a = __action as { action: string; payload?: unknown };
    onAction?.(a.action, a.payload);
  }
  return rest;
}

/** Dispatch to the right provider loop. */
export async function runToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  if (params.providerName === 'anthropic') return runAnthropicToolLoop(params);
  return runOpenAIToolLoop(params);
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function openaiEndpoint(params: ToolLoopParams): string {
  return params.baseUrl ? params.baseUrl.replace(/\/$/, '') + '/chat/completions' : OPENAI_API;
}

async function runOpenAIToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  const endpoint = openaiEndpoint(params);
  // OpenAI auto-caches stable prefixes; just drop the Anthropic-only marker.
  const messages: Array<Record<string, unknown>> = params.messages.map((m) => ({
    role: m.role,
    content: m.content.split(CACHE_BREAKPOINT).join('\n\n'),
  }));
  const tools = params.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let inputTokens = 0;
  let outputTokens = 0;
  const toolsCalled: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          tools,
          temperature: params.temperature ?? 0.2,
          stream: true,
          stream_options: { include_usage: true },
        }),
      },
      { signal: params.signal },
    );
    if (!res.ok || !res.body) throw new Error(`OpenAI error ${res.status}`);

    let stepText = '';
    const callsByIndex = new Map<number, OpenAIToolCall>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const usage = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (usage) {
          inputTokens += usage.prompt_tokens ?? 0;
          outputTokens += usage.completion_tokens ?? 0;
        }
        const delta = (parsed as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content) {
          stepText += delta.content;
          params.onToken?.(delta.content);
        }
        const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (tcs) {
          for (const tc of tcs) {
            const idx = Number(tc.index ?? 0);
            const existing = callsByIndex.get(idx) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) existing.id = String(tc.id);
            const fn = tc.function as { name?: string; arguments?: string } | undefined;
            if (fn?.name) existing.function.name = fn.name;
            if (fn?.arguments) existing.function.arguments += fn.arguments;
            callsByIndex.set(idx, existing);
          }
        }
      }
    }

    const toolCalls = [...callsByIndex.values()].filter((c) => c.function.name);
    if (toolCalls.length === 0) {
      return { text: stepText, inputTokens, outputTokens, toolsCalled };
    }

    messages.push({ role: 'assistant', content: stepText || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      toolsCalled.push(call.function.name);
      params.onToolStart?.(call.function.name);
      const result = extractAction(await executeTool(call.function.name, args, params.ctx), params.onAction);
      messages.push({ role: 'tool', tool_call_id: call.id, content: clampToolResult(result) });
    }
  }

  // Out of tool steps — force a final text answer (streamed).
  return streamOpenAIFinal(params, messages, inputTokens, outputTokens, toolsCalled);
}

async function streamOpenAIFinal(
  params: ToolLoopParams,
  messages: Array<Record<string, unknown>>,
  inputTokens: number,
  outputTokens: number,
  toolsCalled: string[],
): Promise<ToolLoopResult> {
  const res = await fetchWithRetry(
    openaiEndpoint(params),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.2,
        tool_choice: 'none',
        stream: true,
        stream_options: { include_usage: true },
      }),
    },
    { signal: params.signal },
  );
  if (!res.ok || !res.body) throw new Error(`OpenAI error ${res.status}`);
  let text = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.usage) {
          inputTokens += parsed.usage.prompt_tokens ?? 0;
          outputTokens += parsed.usage.completion_tokens ?? 0;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          params.onToken?.(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { text, inputTokens, outputTokens, toolsCalled };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

async function runAnthropicToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  const systemRaw = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  // Prompt caching: cache the stable prefix (before CACHE_BREAKPOINT), leave the
  // volatile knowledge/summary tail uncached.
  const [stableSys, volatileSys] = systemRaw.split(CACHE_BREAKPOINT);
  const system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
  if (stableSys && stableSys.trim()) system.push({ type: 'text', text: stableSys, cache_control: { type: 'ephemeral' } });
  if (volatileSys && volatileSys.trim()) system.push({ type: 'text', text: volatileSys });
  const messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> = normalizeAnthropicTurns(
    params.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  );

  const tools = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  let inputTokens = 0;
  let outputTokens = 0;
  const toolsCalled: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const isFinal = step === MAX_STEPS - 1;
    const res = await fetchWithRetry(
      ANTHROPIC_API,
      {
        method: 'POST',
        headers: {
          'x-api-key': params.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          system: system.length ? system : undefined,
          messages,
          tools: isFinal ? undefined : tools,
          max_tokens: 1024,
          temperature: params.temperature ?? 0.2,
          stream: true,
        }),
      },
      { signal: params.signal },
    );
    if (!res.ok || !res.body) throw new Error(`Anthropic error ${res.status}`);

    const blocks: AnthropicBlock[] = [];
    let stopReason = '';
    let textOut = '';
    const partialJson = new Map<number, string>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(trimmed.slice(5).trim());
        } catch {
          continue;
        }
        const type = evt.type as string;
        if (type === 'message_start') {
          const u = (evt.message as { usage?: { input_tokens?: number } })?.usage;
          inputTokens += u?.input_tokens ?? 0;
        } else if (type === 'content_block_start') {
          const idx = Number(evt.index ?? 0);
          const block = evt.content_block as AnthropicBlock;
          blocks[idx] = { ...block };
          if (block.type === 'tool_use') partialJson.set(idx, '');
        } else if (type === 'content_block_delta') {
          const idx = Number(evt.index ?? 0);
          const d = evt.delta as { type?: string; text?: string; partial_json?: string };
          if (d.type === 'text_delta' && d.text) {
            textOut += d.text;
            params.onToken?.(d.text);
            blocks[idx] = blocks[idx] ?? { type: 'text', text: '' };
            blocks[idx].text = (blocks[idx].text ?? '') + d.text;
          } else if (d.type === 'input_json_delta' && d.partial_json != null) {
            partialJson.set(idx, (partialJson.get(idx) ?? '') + d.partial_json);
          }
        } else if (type === 'message_delta') {
          const sr = (evt.delta as { stop_reason?: string })?.stop_reason;
          if (sr) stopReason = sr;
          const u = (evt as { usage?: { output_tokens?: number } }).usage;
          if (u?.output_tokens != null) outputTokens += u.output_tokens;
        }
      }
    }

    // Finalize tool_use block inputs from accumulated JSON.
    for (const [idx, json] of partialJson) {
      if (blocks[idx]) {
        try {
          blocks[idx].input = JSON.parse(json || '{}');
        } catch {
          blocks[idx].input = {};
        }
      }
    }

    const toolUses = blocks.filter((b) => b && b.type === 'tool_use');
    if (stopReason !== 'tool_use' || toolUses.length === 0) {
      return { text: textOut, inputTokens, outputTokens, toolsCalled };
    }

    // Record the assistant's blocks, then return tool results in a user turn.
    messages.push({ role: 'assistant', content: blocks.filter(Boolean) });
    const resultBlocks: AnthropicBlock[] = [];
    for (const tu of toolUses) {
      toolsCalled.push(tu.name ?? 'unknown');
      params.onToolStart?.(tu.name ?? '');
      const result = extractAction(
        await executeTool(tu.name ?? '', (tu.input as Record<string, unknown>) ?? {}, params.ctx),
        params.onAction,
      );
      resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: clampToolResult(result) });
    }
    messages.push({ role: 'user', content: resultBlocks });
  }

  return { text: '', inputTokens, outputTokens, toolsCalled };
}
