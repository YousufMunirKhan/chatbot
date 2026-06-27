/**
 * Model routing (Issue #10). Escalate genuinely hard questions to the stronger
 * `advancedChatModel`; keep the cheap default for everyday queries. Saves money
 * on simple turns while giving better answers where it matters.
 */

// Reasoning / comparison signals in EN + AR that benefit from a stronger model.
const COMPLEX_HINTS = [
  /\bcompare\b/i,
  /\bdifference\b/i,
  /\brecommend|suggest\b/i,
  /\bwhy\b/i,
  /\bexplain\b/i,
  /\bbest\b/i,
  /\bvs\.?\b/i,
  /\bwhich (one|should|is better)\b/i,
  /\bcalculate|how much (would|will|do)\b/i,
  /\bpros and cons|trade-?offs?\b/i,
  /\bstep by step\b/i,
  // Arabic
  /قارن|الفرق|توصي|أنصح|لماذا|اشرح|أفضل|أيهما|الأفضل/,
];

export interface ModelRouteInput {
  text: string;
  chatModel: string;
  advancedChatModel: string;
  /** Number of tools the bot may call — multi-tool tasks lean complex. */
  toolCount?: number;
}

/**
 * Pick the chat model for this turn. Heuristic, deterministic, cheap:
 * long messages, multiple questions/sentences, reasoning keywords, or many
 * available tools route to the advanced model.
 */
export function pickChatModel(input: ModelRouteInput): { model: string; advanced: boolean } {
  const text = input.text.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const questionMarks = (text.match(/[?؟]/g) ?? []).length;
  const sentences = text.split(/[.!?؟\n]+/).filter((s) => s.trim().length > 0).length;

  let score = 0;
  if (words > 45) score += 2;
  else if (words > 25) score += 1;
  if (questionMarks >= 2) score += 1;
  if (sentences >= 3) score += 1;
  if ((input.toolCount ?? 0) >= 4) score += 1;
  if (COMPLEX_HINTS.some((re) => re.test(text))) score += 2;

  const advanced =
    score >= 2 && Boolean(input.advancedChatModel) && input.advancedChatModel !== input.chatModel;
  return { model: advanced ? input.advancedChatModel : input.chatModel, advanced };
}
