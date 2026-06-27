import {
  BASE_TEMPLATES,
  CAPABILITY_SNIPPETS,
  GROUNDING,
  INDUSTRY_SUFFIX,
  LANGUAGE_DIRECTIVE,
  SECTION_HEADERS,
  TONE_PHRASES,
  type PromptLang,
} from './templates';

/**
 * Assistant prompt configuration (Module 6). Persisted in `bot_settings`
 * under key `prompt_config`.
 */
export interface PromptConfig {
  industry?: string | null;
  tone?: string | null;
  customInstructions?: string | null;
  customPrompt?: string | null;
}

export interface AssembleInput {
  botType: string;
  assistantAudience?: 'customer' | 'internal';
  /** 'en' | 'ar' | 'auto' */
  language: string;
  businessName: string;
  businessContext?: string | null;
  capabilities: string[];
  config: PromptConfig;
}

/**
 * Build the full system prompt from role (bot type) + industry + capabilities +
 * business context + grounding rules + language directive
 * (Acceptance: "prompt is assembled from role + industry + capabilities").
 */
export function assembleSystemPrompt(input: AssembleInput): string {
  const lang: PromptLang = input.language === 'ar' ? 'ar' : 'en';
  const tone = input.config.tone || 'professional';
  const tonePhrase =
    TONE_PHRASES[lang]?.[tone] ?? TONE_PHRASES[lang]?.professional ?? 'professional';

  const industry = input.config.industry?.trim();
  const industrySuffix = industry
    ? (INDUSTRY_SUFFIX[lang] ?? '').replace('{{industry}}', industry)
    : '';

  let base: string;
  if (input.botType === 'custom' && input.config.customPrompt?.trim()) {
    base = input.config.customPrompt.trim();
  } else if (input.assistantAudience === 'internal') {
    const tmplSet = BASE_TEMPLATES.internal_help_desk ?? BASE_TEMPLATES.help_desk;
    base = (tmplSet?.[lang] ?? '')
      .replace('{{businessName}}', input.businessName || 'the business')
      .replace('{{industrySuffix}}', industrySuffix)
      .replace('{{tone}}', tonePhrase);
  } else {
    const tmplSet = BASE_TEMPLATES[input.botType] ?? BASE_TEMPLATES.hybrid_business_assistant;
    base = (tmplSet?.[lang] ?? '')
      .replace('{{businessName}}', input.businessName || 'the business')
      .replace('{{industrySuffix}}', industrySuffix)
      .replace('{{tone}}', tonePhrase);
  }

  const sections: string[] = [base];

  const businessContext = input.businessContext?.trim();
  if (businessContext) {
    sections.push(`${SECTION_HEADERS.business[lang]}\n${businessContext}`);
  }

  const caps = input.capabilities.filter((c) => CAPABILITY_SNIPPETS[c]);
  if (caps.length > 0) {
    const lines = caps.map((c) => `- ${CAPABILITY_SNIPPETS[c]?.[lang] ?? ''}`).join('\n');
    sections.push(`${SECTION_HEADERS.capabilities[lang]}\n${lines}`);
  }

  sections.push(GROUNDING[lang] ?? '');

  if (input.assistantAudience !== 'internal') {
    sections.push(
      lang === 'ar'
        ? 'أسلوب المحادثة:\n- اجعل الردود قصيرة وطبيعية ومفيدة.\n- عند السؤال عن منتج أو سعر، أجب بالمعلومة المباشرة أولا ثم اطرح سؤال متابعة واحدا مفيدا.'
        : 'Live chat style:\n- Keep replies short, natural, and useful.\n- When asked for a product or price, answer with the direct product and price first, then ask one helpful follow-up question.',
    );
  } else {
    sections.push(
      lang === 'ar'
        ? 'Internal help desk style:\n- Give staff short, step-by-step answers.\n- For "where is it?" questions, name the exact section, tab, or data area when known.\n- For changes, explain the safe action and require confirmation before any write/update.\n- If the internal guide is missing, say exactly what documentation should be added.'
        : 'Internal help desk style:\n- Give staff short, step-by-step answers.\n- For "where is it?" questions, name the exact section, tab, or data area when known.\n- For changes, explain the safe action and require confirmation before any write/update.\n- If the internal guide is missing, say exactly what documentation should be added.',
    );
  }

  const extra = input.config.customInstructions?.trim();
  if (extra) {
    sections.push(`${SECTION_HEADERS.additional[lang]}\n${extra}`);
  }

  sections.push(LANGUAGE_DIRECTIVE[input.language] ?? LANGUAGE_DIRECTIVE.auto ?? '');

  return sections.filter(Boolean).join('\n\n');
}
