/**
 * Language handling (Module 21). Centralizes Arabic/English detection,
 * normalization, and Arabizi recognition so the engine and tools respond in the
 * customer's language (English, Arabic, Gulf dialect, Arabizi, or mixed).
 */
const ARABIC_RE = /[؀-ۿݐ-ݿ]/g;

/** Strip Arabic diacritics (tashkeel) and unify common letter variants. */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ؗ-ًؚ-ْٰ]/g, '') // tashkeel
    .replace(/[أإآ]/g, 'ا') // أ إ آ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ـ/g, ''); // tatweel
}

// Common Arabizi words + the chat-alphabet digits used for Arabic letters.
const ARABIZI_WORDS = /\b(7abibi|habibi|shukran|inshallah|ya3ni|wallah|akhi|ukht|kaif|keef|shou|sho|ahlan|salam|3afak|min|fadlak|mar7aba|marhaba|kefak|cheft|3andi|3indi|ana|enta|inta)\b/i;
const ARABIZI_DIGITS = /\b[a-z]*[2357][a-z]+\b/i; // e.g. m3ak, 7elw, 2ana, mar7aba

/** Heuristic Arabizi detection (Arabic written in Latin letters + numerals). */
export function detectArabizi(text: string): boolean {
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (latin < 2) return false;
  return ARABIZI_WORDS.test(text) || ARABIZI_DIGITS.test(text);
}

/**
 * Detect the reply language. Arabic script or Arabizi → 'ar'; otherwise 'en'.
 * Mixed messages with significant Arabic content reply in Arabic.
 */
export function detectLanguage(text: string): 'ar' | 'en' {
  const arabic = (text.match(ARABIC_RE) ?? []).length;
  const letters = (text.match(/[A-Za-z؀-ۿ]/g) ?? []).length || 1;
  if (arabic / letters > 0.25) return 'ar';
  if (detectArabizi(text)) return 'ar';
  return 'en';
}

/**
 * Conversation-aware language (Issue #20). A short or ambiguous message
 * ("ok", "123", "👍") shouldn't flip an Arabic chat to English. When the
 * current message carries a weak signal, inherit the dominant language of the
 * recent turns instead.
 */
export function detectConversationLanguage(current: string, recent: string[] = []): 'ar' | 'en' {
  const currentLang = detectLanguage(current);
  const letters = (current.match(/[A-Za-z؀-ۿ]/g) ?? []).length;
  // Strong, unambiguous signal — trust the current message.
  if (letters >= 4) return currentLang;
  if (recent.length === 0) return currentLang;
  let ar = 0;
  let en = 0;
  for (const t of recent) {
    if (detectLanguage(t) === 'ar') ar++;
    else en++;
  }
  if (ar === en) return currentLang;
  return ar > en ? 'ar' : 'en';
}
