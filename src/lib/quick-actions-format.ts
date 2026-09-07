/**
 * Turning a submitted form into something a person can read.
 *
 * A quick-action submission used to be stored as `Label: {"name":"Ammad
 * Hussain","phone":"07405398352",...}` — raw JSON sitting in the conversation
 * transcript and in the inbox preview, which is what an agent saw instead of
 * "who is this and what do they want".
 */

/** `first_name` / `firstName` → "First name". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => renderValue(v)).filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${fieldLabel(k)}: ${renderValue(v)}`)
      .join(', ');
  }
  return String(value).trim();
}

/**
 * One line per answered field, under the action's own name. Empty fields are
 * dropped — a form with eight optional questions should not produce eight
 * "(blank)" lines in the transcript.
 */
export function formatActionSubmission(label: string, values: unknown): string {
  const record =
    values && typeof values === 'object' && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  const lines = Object.entries(record)
    .map(([key, value]) => [fieldLabel(key), renderValue(value)] as const)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value}`);

  return lines.length ? `${label}\n${lines.join('\n')}` : label;
}

/**
 * Rescue a message that was stored before the formatter existed.
 *
 * Matches `Anything: {json}` and re-renders it. Anything else is returned
 * untouched, so an ordinary message that happens to contain a brace is safe.
 */
export function humanizeStoredSubmission(text: string): string {
  const match = /^([^{}\n]{1,80}?):\s*(\{[\s\S]*\})\s*$/.exec(text.trim());
  if (!match) return text;
  try {
    const parsed = JSON.parse(match[2] as string);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return text;
    return formatActionSubmission((match[1] as string).trim(), parsed);
  } catch {
    return text;
  }
}
