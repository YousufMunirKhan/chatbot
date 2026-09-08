import crypto from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * Time-based one-time passwords (RFC 6238) — the second factor people already
 * have on their phone.
 *
 * Everything here is self-contained on purpose. There is no TOTP package and no
 * QR package in this project's dependencies, and adding one for ~250 lines of
 * very stable, very well-specified arithmetic would be a new supply-chain
 * surface guarding the sign-in path. The QR encoder below emits an SVG the page
 * renders inline, so the shared secret is never handed to a third-party image
 * service the way `chart.googleapis.com/chart?chl=otpauth://…` used to do it.
 *
 * The secret itself is stored ENCRYPTED, through the same `encryptSecret()` that
 * protects every other credential in this product. A plaintext TOTP secret is
 * worth exactly as much as no second factor at all.
 */

/**
 * `@/lib/crypto` is loaded on demand rather than at the top of this file.
 *
 * The session check in `src/lib/auth/index.ts` imports this module, and
 * `scripts/test-query-counts.mjs` loads that file through a transpiler with a
 * hand-written stub for every `@/…` specifier in its graph — an unstubbed one
 * is left as a bare package and fails to resolve. A static import here would
 * therefore drag `@/lib/crypto`, and through it `@/lib/env`, into that graph
 * and stop the round-trip budget test from starting at all.
 *
 * Nothing on the session-check path needs the cipher, so it is fetched only
 * where a secret is genuinely being wrapped or unwrapped. The promise is held
 * so the module is evaluated once per process, not once per call.
 */
let secretCipherModule: Promise<typeof import('@/lib/crypto')> | null = null;
function secretCipher(): Promise<typeof import('@/lib/crypto')> {
  secretCipherModule ??= import('@/lib/crypto');
  return secretCipherModule;
}

/** RFC 6238 default. Every authenticator app assumes 30 seconds. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * How far either side of "now" a code is still accepted, in 30-second steps.
 *
 * One step means a code stays valid for up to 90 seconds in the worst case
 * (the step before, the current one, the step after). That covers the two real
 * causes of failure — a phone whose clock has drifted by a few tens of seconds,
 * and somebody who starts typing at second 29 — without widening the window an
 * attacker gets. It is what Google, GitHub and Okta all settle on.
 */
export const TOTP_DRIFT_STEPS = 1;

/** How long a scanned-but-unproved secret stays offerable before it is dropped. */
export const TOTP_ENROLMENT_WINDOW_MS = 15 * 60 * 1000;

export const RECOVERY_CODE_COUNT = 10;

/** How long a completed verification is trusted before it is asked for again. */
export const TWO_FACTOR_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — the alphabet every authenticator app expects
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison.
 *
 * `a === b` on a six-digit code leaks how many leading digits were right,
 * because the comparison stops at the first mismatch. Over enough attempts that
 * turns a 10^6 search into six 10-way searches. `timingSafeEqual` refuses
 * different lengths, so the length check happens first and separately — length
 * is not a secret here, the format is public.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/** A fresh 160-bit secret, base32 — the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The current 30-second step number for a moment in time. */
export function totpStepAt(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * The six digits a correctly configured authenticator shows for `step`.
 *
 * `readUInt32BE` rather than four indexed reads, because this project compiles
 * with `noUncheckedIndexedAccess` and the Buffer methods return a plain number
 * — the dynamic truncation of RFC 4226 is the same arithmetic either way.
 */
export function totpCodeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const truncated = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Strip the spaces authenticator apps display between digit groups. */
export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export type TotpFailure = 'malformed' | 'incorrect' | 'reused';

export interface TotpVerification {
  ok: boolean;
  /** The step the code came from. Persist it: it is the replay guard. */
  step: number | null;
  reason?: TotpFailure;
}

/**
 * Check a code, and refuse one that has already been spent.
 *
 * `lastStep` is the highest step this user has ever successfully used. A code
 * from that step or earlier is rejected outright even if the arithmetic checks
 * out, which is what makes a TOTP code single-use: without it, a code read over
 * somebody's shoulder stays good for the rest of its 30-second life, and the
 * drift window quietly makes that 90 seconds.
 *
 * Every candidate step is compared in constant time. The loop does return early
 * on a match, which reveals roughly which step matched — that is public
 * information (it is the clock), not a secret.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options: { atMs?: number; lastStep?: number | null; driftSteps?: number } = {},
): TotpVerification {
  const candidate = normalizeTotpCode(code);
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(candidate)) {
    return { ok: false, step: null, reason: 'malformed' };
  }

  const drift = options.driftSteps ?? TOTP_DRIFT_STEPS;
  const current = totpStepAt(options.atMs ?? Date.now());
  const lastStep = options.lastStep ?? null;

  let sawReusedStep = false;
  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (!timingSafeEqualStrings(totpCodeAt(secret, step), candidate)) continue;
    if (lastStep !== null && step <= lastStep) {
      sawReusedStep = true;
      continue;
    }
    return { ok: true, step };
  }

  // Telling these two apart matters for the message on screen: "you already
  // used that one, wait for the next" is actionable, "that code is wrong" when
  // the code was in fact right is the kind of thing that ends in a support call.
  return { ok: false, step: null, reason: sawReusedStep ? 'reused' : 'incorrect' };
}

/** The most bytes `totpQrSvg` can carry (version 10, error correction level L). */
export const TOTP_QR_MAX_BYTES = 271;

/**
 * `:` separates the label's two halves, so it cannot appear inside either — a
 * company calling itself "Acme: Support" would otherwise produce a URI some
 * apps read as carrying a third field. Control characters go the same way.
 */
function sanitizeLabel(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0) ?? 32;
      return code < 32 || code === 127 || character === ':' ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTotpUri(secret: string, account: string, issuer: string): string {
  const label = issuer
    ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
    : encodeURIComponent(account);
  const query = new URLSearchParams({ secret });
  if (issuer) query.set('issuer', issuer);
  query.set('algorithm', 'SHA1');
  query.set('digits', String(TOTP_DIGITS));
  query.set('period', String(TOTP_PERIOD_SECONDS));
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * The `otpauth://` URI an authenticator app reads out of the QR code.
 *
 * The label carries the issuer twice — once as the `Issuer:Account` prefix and
 * once as a query parameter — because older Authenticator builds read only the
 * prefix and newer ones only the parameter, and getting it wrong means the
 * entry appears in the user's app called "Account" with no idea which product
 * it belongs to.
 *
 * The trimming loops are not cosmetic. This product runs in Arabic as well as
 * English, and a company name in Arabic percent-encodes to six bytes per
 * character — so a name that looks short on screen can push the URI past what
 * any QR code below version 11 can carry. Rather than throw on the enrolment
 * page, the display label is shortened until it fits: the issuer first, because
 * it is redundant (it appears twice), and only then the account. The secret and
 * the algorithm parameters are never touched, so a trimmed label still produces
 * exactly the right codes.
 */
export function totpUri(params: { secret: string; account: string; issuer: string }): string {
  let issuer = sanitizeLabel(params.issuer);
  let account = sanitizeLabel(params.account);
  const fits = (uri: string) => Buffer.byteLength(uri, 'utf8') <= TOTP_QR_MAX_BYTES;

  let uri = buildTotpUri(params.secret, account, issuer);
  while (!fits(uri) && issuer.length > 0) {
    issuer = issuer.slice(0, -1).trimEnd();
    uri = buildTotpUri(params.secret, account, issuer);
  }
  while (!fits(uri) && account.length > 1) {
    account = account.slice(0, -1);
    uri = buildTotpUri(params.secret, account, issuer);
  }
  return uri;
}

/** The secret in readable blocks, for somebody typing it in by hand. */
export function formatSecretForDisplay(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(' ');
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Ten codes of ten base32 characters: fifty bits of entropy each, drawn with
 * `randomInt` so the alphabet stays unbiased.
 *
 * Formatted `XXXXX-XXXXX` so a person can read one off paper without losing
 * their place, and so the sign-in box can tell a recovery code from a six-digit
 * TOTP code by shape alone.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    let raw = '';
    for (let i = 0; i < 10; i += 1) raw += BASE32_ALPHABET.charAt(crypto.randomInt(0, 32));
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    if (!codes.includes(formatted)) codes.push(formatted);
  }
  return codes;
}

/** Case and punctuation are noise; the code is what is left. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Hashed, so reading the table does not spend anybody's codes.
 *
 * SHA-256 with no work factor is the right call here and only here: these are
 * fifty random bits, not a password somebody chose, so there is no dictionary
 * to run and nothing for a slow hash to buy. A slow hash would also have to run
 * once per stored code on every attempt, which is ten scrypt calls per sign-in.
 */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// ---------------------------------------------------------------------------
// QR code (byte mode, versions 1–10, error correction level M then L)
// ---------------------------------------------------------------------------
//
// Level M corrects ~15% of the symbol, which is what a phone camera wants when
// it is held at arm's length in front of a screen, so it is tried first. It
// tops out at 213 bytes across versions 1–10; a long company name in Arabic
// percent-encodes to six bytes a character and can exceed that, so level L
// (~7% correction, 271 bytes) is the fallback rather than a failure. Beyond
// that `totpQrSvg` throws — emitting a symbol that cannot be read is worse than
// saying so.

interface QrSpec {
  /** Data plus error-correction codewords for the whole symbol. */
  totalCodewords: number;
  dataCodewords: number;
  ecPerBlock: number;
  blocks: number;
}

/** Block structures for versions 1–10 at each error-correction level used here. */
const QR_SPECS: Record<'M' | 'L', QrSpec[]> = {
  M: [
    { totalCodewords: 26, dataCodewords: 16, ecPerBlock: 10, blocks: 1 }, // v1
    { totalCodewords: 44, dataCodewords: 28, ecPerBlock: 16, blocks: 1 }, // v2
    { totalCodewords: 70, dataCodewords: 44, ecPerBlock: 26, blocks: 1 }, // v3
    { totalCodewords: 100, dataCodewords: 64, ecPerBlock: 18, blocks: 2 }, // v4
    { totalCodewords: 134, dataCodewords: 86, ecPerBlock: 24, blocks: 2 }, // v5
    { totalCodewords: 172, dataCodewords: 108, ecPerBlock: 16, blocks: 4 }, // v6
    { totalCodewords: 196, dataCodewords: 124, ecPerBlock: 18, blocks: 4 }, // v7
    { totalCodewords: 242, dataCodewords: 154, ecPerBlock: 22, blocks: 4 }, // v8
    { totalCodewords: 292, dataCodewords: 182, ecPerBlock: 22, blocks: 5 }, // v9
    { totalCodewords: 346, dataCodewords: 216, ecPerBlock: 26, blocks: 5 }, // v10
  ],
  L: [
    { totalCodewords: 26, dataCodewords: 19, ecPerBlock: 7, blocks: 1 }, // v1
    { totalCodewords: 44, dataCodewords: 34, ecPerBlock: 10, blocks: 1 }, // v2
    { totalCodewords: 70, dataCodewords: 55, ecPerBlock: 15, blocks: 1 }, // v3
    { totalCodewords: 100, dataCodewords: 80, ecPerBlock: 20, blocks: 1 }, // v4
    { totalCodewords: 134, dataCodewords: 108, ecPerBlock: 26, blocks: 1 }, // v5
    { totalCodewords: 172, dataCodewords: 136, ecPerBlock: 18, blocks: 2 }, // v6
    { totalCodewords: 196, dataCodewords: 156, ecPerBlock: 20, blocks: 2 }, // v7
    { totalCodewords: 242, dataCodewords: 194, ecPerBlock: 24, blocks: 2 }, // v8
    { totalCodewords: 292, dataCodewords: 232, ecPerBlock: 30, blocks: 2 }, // v9
    { totalCodewords: 346, dataCodewords: 274, ecPerBlock: 18, blocks: 4 }, // v10
  ],
};

const QR_ALIGNMENT_CENTRES: number[][] = [
  [], // v1
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** 15-bit BCH format strings, indexed by EC level then mask pattern 0–7. */
const QR_FORMAT_INFO: Record<'M' | 'L', number[]> = {
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
};

/** 18-bit BCH version strings, versions 7–10 (earlier versions carry none). */
const QR_VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

/**
 * One byte out of a typed array, as a number.
 *
 * `noUncheckedIndexedAccess` is on across this project, so every indexed read
 * is `T | undefined`. The routines below index by arithmetic that is bounded by
 * construction, several hundred times over; this reader keeps that arithmetic
 * legible instead of scattering non-null assertions through it. Out of range
 * reads as zero, which is the light module an untouched position already holds.
 */
function byteAt(array: Uint8Array, index: number): number {
  return array[index] ?? 0;
}

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = byteAt(GF_EXP, i - 255);
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return byteAt(GF_EXP, byteAt(GF_LOG, a) + byteAt(GF_LOG, b));
}

/** Generator polynomial of the given degree, highest coefficient first. */
function rsGenerator(degree: number): Uint8Array {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = byteAt(next, j) ^ byteAt(poly, j);
      next[j + 1] = byteAt(next, j + 1) ^ gfMul(byteAt(poly, j), byteAt(GF_EXP, i));
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGenerator(ecLength);
  const remainder = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ byteAt(remainder, 0);
    remainder.copyWithin(0, 1);
    remainder[ecLength - 1] = 0;
    for (let j = 0; j < ecLength; j += 1) {
      remainder[j] = byteAt(remainder, j) ^ gfMul(byteAt(gen, j + 1), factor);
    }
  }
  return remainder;
}

type QrLevel = 'M' | 'L';

/** The block structure for one version at one level, or a loud failure. */
function qrSpec(level: QrLevel, version: number): QrSpec {
  const spec = QR_SPECS[level][version - 1];
  if (!spec) throw new Error(`No QR block structure for version ${version} at level ${level}.`);
  return spec;
}

/**
 * The smallest symbol that will hold the text, preferring the sturdier level.
 *
 * Level M is exhausted across all ten versions before level L is considered:
 * a smaller symbol with weak correction scans worse off a screen than a larger
 * one with good correction, so size is the thing to give up second.
 */
function qrChooseSymbol(byteLength: number): { level: QrLevel; version: number } {
  for (const level of ['M', 'L'] as const) {
    const specs = QR_SPECS[level];
    for (let version = 1; version <= specs.length; version += 1) {
      const countBits = version >= 10 ? 16 : 8;
      const capacity = Math.floor((qrSpec(level, version).dataCodewords * 8 - 4 - countBits) / 8);
      if (byteLength <= capacity) return { level, version };
    }
  }
  throw new Error('Text is too long for a version 10 QR code.');
}

/** Mode indicator, length, payload, terminator, padding — then EC and interleave. */
function qrCodewords(text: string, level: QrLevel, version: number): Uint8Array {
  const spec = qrSpec(level, version);
  const payload = Buffer.from(text, 'utf8');
  const countBits = version >= 10 ? 16 : 8;

  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(payload.length, countBits);
  for (const byte of payload) push(byte, 8);

  const capacityBits = spec.dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    data[i / 8] = byte;
  }
  // The spec's alternating pad bytes, 11101100 / 00010001.
  for (let i = bits.length / 8; i < spec.dataCodewords; i += 1) {
    data[i] = i % 2 === 0 ? 0xec : 0x11;
  }

  // Blocks are as equal as they can be, with the longer ones last.
  const shortLength = Math.floor(spec.dataCodewords / spec.blocks);
  const longBlocks = spec.dataCodewords % spec.blocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let cursor = 0;
  for (let b = 0; b < spec.blocks; b += 1) {
    const length = shortLength + (b >= spec.blocks - longBlocks ? 1 : 0);
    const block = data.subarray(cursor, cursor + length);
    cursor += length;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(byteAt(block, i));
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(byteAt(block, i));
  }
  return Uint8Array.from(out);
}

const QR_MASKS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function qrMask(index: number): (row: number, col: number) => boolean {
  const mask = QR_MASKS[index];
  if (!mask) throw new Error(`No QR mask pattern ${index}.`);
  return mask;
}

/**
 * The symbol as two flat grids: what is dark, and what is a function pattern.
 *
 * Flat rather than an array of rows because every read below would otherwise be
 * a double index, and each one comes back `Uint8Array | undefined` under this
 * project's `noUncheckedIndexedAccess`. One index and one `byteAt` keeps the
 * placement arithmetic readable, which is the part that has to be right.
 */
interface QrCanvas {
  size: number;
  modules: Uint8Array;
  functional: Uint8Array;
}

function qrBlankCanvas(version: number): QrCanvas {
  const size = version * 4 + 17;
  return {
    size,
    modules: new Uint8Array(size * size),
    functional: new Uint8Array(size * size),
  };
}

/** Is the module at (row, col) dark? Out of bounds reads as light. */
function qrGet(canvas: QrCanvas, row: number, col: number): number {
  return byteAt(canvas.modules, row * canvas.size + col);
}

function qrIsFunctional(canvas: QrCanvas, row: number, col: number): boolean {
  return byteAt(canvas.functional, row * canvas.size + col) === 1;
}

function qrPlaceFunctionPatterns(canvas: QrCanvas, version: number): void {
  const { size, modules, functional } = canvas;
  const set = (r: number, c: number, dark: number) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r * size + c] = dark;
    functional[r * size + c] = 1;
  };

  // Finder patterns and their separators.
  const finderOrigins: Array<[number, number]> = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
  for (const [baseR, baseC] of finderOrigins) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const isDark =
          inRing &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(baseR + r, baseC + c, isDark ? 1 : 0);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns, minus the three that would sit on a finder.
  const centres = QR_ALIGNMENT_CENTRES[version - 1] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          set(r + dr, c + dc, edge === 1 ? 0 : 1);
        }
      }
    }
  }

  // Reserve the format areas; the real bits go in after masking. Index 6 is
  // skipped in both directions: (8,6) and (6,8) belong to the timing patterns
  // written just above, and blanking them here would break the symbol in a way
  // no scanner reports — it simply fails to read.
  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) continue;
    set(8, i, 0);
    set(i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    set(8, size - 1 - i, 0);
    set(size - 1 - i, 8, 0);
  }
  // The one module that is always dark.
  set(size - 8, 8, 1);

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      set(Math.floor(i / 3), size - 11 + (i % 3), 0);
      set(size - 11 + (i % 3), Math.floor(i / 3), 0);
    }
  }
}

function qrPlaceData(canvas: QrCanvas, codewords: Uint8Array): void {
  const { size, modules } = canvas;
  let bitIndex = 0;
  let upwards = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern. Reassigning `right` rather than
    // reading past it is deliberate: the column pairs after the skip are
    // (5,4), (3,2), (1,0), and merely substituting a value here would visit
    // column 4 twice and drop column 0 entirely.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upwards ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (qrIsFunctional(canvas, row, col)) continue;
        // Anything past the last codeword is a remainder bit, which is zero.
        const bit =
          bitIndex < codewords.length * 8
            ? (byteAt(codewords, bitIndex >> 3) >>> (7 - (bitIndex & 7))) & 1
            : 0;
        modules[row * size + col] = bit;
        bitIndex += 1;
      }
    }
    upwards = !upwards;
  }
}

function qrPenalty(canvas: QrCanvas): number {
  const { size } = canvas;
  let score = 0;

  // Rule 1 — runs of five or more of one colour.
  for (let i = 0; i < size; i += 1) {
    for (const readRow of [true, false]) {
      let run = 1;
      let previous = readRow ? qrGet(canvas, i, 0) : qrGet(canvas, 0, i);
      for (let j = 1; j < size; j += 1) {
        const value = readRow ? qrGet(canvas, i, j) : qrGet(canvas, j, i);
        if (value === previous) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          previous = value;
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2 — 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = qrGet(canvas, r, c);
      if (
        v === qrGet(canvas, r, c + 1) &&
        v === qrGet(canvas, r + 1, c) &&
        v === qrGet(canvas, r + 1, c + 1)
      ) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-lookalike sequence, either way round.
  const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get: (k: number) => number, start: number, pattern: number[]) => {
    for (let k = 0; k < pattern.length; k += 1) if (get(start + k) !== pattern[k]) return false;
    return true;
  };
  for (let i = 0; i < size; i += 1) {
    const row = (k: number) => qrGet(canvas, i, k);
    const col = (k: number) => qrGet(canvas, k, i);
    for (let j = 0; j + 11 <= size; j += 1) {
      if (matches(row, j, patternA) || matches(row, j, patternB)) score += 40;
      if (matches(col, j, patternA) || matches(col, j, patternB)) score += 40;
    }
  }

  // Rule 4 — drift away from a 50/50 light/dark balance.
  let dark = 0;
  for (let i = 0; i < canvas.modules.length; i += 1) dark += byteAt(canvas.modules, i);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function qrApplyMaskAndFormat(
  canvas: QrCanvas,
  level: QrLevel,
  version: number,
  mask: number,
): QrCanvas {
  const { size } = canvas;
  const masked: QrCanvas = {
    size,
    modules: Uint8Array.from(canvas.modules),
    functional: canvas.functional,
  };
  const put = (r: number, c: number, value: number) => {
    masked.modules[r * size + c] = value;
  };

  const maskFn = qrMask(mask);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!qrIsFunctional(canvas, r, c) && maskFn(r, c)) put(r, c, qrGet(canvas, r, c) ^ 1);
    }
  }

  const format = QR_FORMAT_INFO[level][mask] ?? 0;
  const bit = (index: number) => (format >>> index) & 1;
  for (let i = 0; i <= 5; i += 1) put(8, i, bit(14 - i));
  put(8, 7, bit(8));
  put(8, 8, bit(7));
  put(7, 8, bit(6));
  for (let i = 0; i <= 5; i += 1) put(5 - i, 8, bit(5 - i));
  for (let i = 0; i <= 6; i += 1) put(size - 1 - i, 8, bit(i));
  for (let i = 7; i <= 14; i += 1) put(8, size - 15 + i, bit(i));
  put(size - 8, 8, 1);

  if (version >= 7) {
    const info = QR_VERSION_INFO[version] ?? 0;
    for (let i = 0; i < 18; i += 1) {
      const value = (info >>> i) & 1;
      put(Math.floor(i / 3), size - 11 + (i % 3), value);
      put(size - 11 + (i % 3), Math.floor(i / 3), value);
    }
  }
  return masked;
}

/**
 * A QR code as an inline SVG string.
 *
 * All eight mask patterns are built and scored by the spec's four penalty
 * rules, and the best one wins. Picking a fixed mask is a tempting shortcut and
 * produces symbols that some phones read slowly or not at all — this runs once
 * per enrolment, so the extra work costs nothing anybody will notice.
 *
 * `fill="currentColor"` rather than black: the dashboard has a dark theme, and
 * a black-on-transparent symbol on a dark card is unscannable.
 */
export function totpQrSvg(text: string, options: { moduleSize?: number } = {}): string {
  const { level, version } = qrChooseSymbol(Buffer.byteLength(text, 'utf8'));
  const codewords = qrCodewords(text, level, version);

  const base = qrBlankCanvas(version);
  qrPlaceFunctionPatterns(base, version);
  qrPlaceData(base, codewords);

  let best: QrCanvas | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = qrApplyMaskAndFormat(base, level, version, mask);
    const score = qrPenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best) throw new Error('No QR mask pattern could be scored.');
  const chosen = best;

  const quiet = 4; // the spec's mandatory margin; scanners rely on it
  const moduleSize = options.moduleSize ?? 6;
  const span = chosen.size + quiet * 2;
  const paths: string[] = [];
  for (let r = 0; r < chosen.size; r += 1) {
    for (let c = 0; c < chosen.size; c += 1) {
      if (qrGet(chosen, r, c)) paths.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}"`,
    ` width="${span * moduleSize}" height="${span * moduleSize}" shape-rendering="crispEdges"`,
    ` role="img" aria-label="QR code for setting up your authenticator app">`,
    `<rect width="${span}" height="${span}" fill="#ffffff"/>`,
    `<path fill="currentColor" d="${paths.join('')}"/>`,
    `</svg>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Stored state
// ---------------------------------------------------------------------------

export type TwoFactorMethod = 'email' | 'totp';

export interface UserTwoFactorState {
  enabled: boolean;
  method: TwoFactorMethod | null;
  verifiedAt: string | null;
  confirmedAt: string | null;
  /** A secret that has been shown but not proved yet, if enrolment is mid-flight. */
  pendingSecret: string | null;
  lastStep: number | null;
}

const SECURITY_COLUMNS =
  'two_factor_enabled,two_factor_method,two_factor_verified_at,totp_secret_encrypted,' +
  'totp_pending_secret_encrypted,totp_pending_started_at,totp_confirmed_at,totp_last_step';

interface SecuritySettingsRow {
  two_factor_enabled?: boolean | null;
  two_factor_method?: string | null;
  two_factor_verified_at?: string | null;
  totp_secret_encrypted?: string | null;
  totp_pending_secret_encrypted?: string | null;
  totp_pending_started_at?: string | null;
  totp_confirmed_at?: string | null;
  totp_last_step?: number | null;
}

/**
 * A stored secret that will not decrypt is treated as no secret at all.
 *
 * That happens for one realistic reason — ENCRYPTION_KEY was rotated without
 * re-wrapping — and the alternative is throwing inside the session check, which
 * would take the whole product down for that user rather than asking them to
 * enrol again.
 */
async function safeDecrypt(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  try {
    return (await secretCipher()).decryptSecret(payload);
  } catch {
    return null;
  }
}

export async function getUserTwoFactorState(userId: string): Promise<UserTwoFactorState> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('user_security_settings')
    .select(SECURITY_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  const row = (data ?? null) as SecuritySettingsRow | null;

  const startedAt = row?.totp_pending_started_at ? Date.parse(row.totp_pending_started_at) : 0;
  const pendingIsFresh = startedAt > 0 && Date.now() - startedAt < TOTP_ENROLMENT_WINDOW_MS;

  return {
    enabled: Boolean(row?.two_factor_enabled),
    method: (row?.two_factor_method as TwoFactorMethod | undefined) ?? null,
    verifiedAt: row?.two_factor_verified_at ?? null,
    confirmedAt: row?.totp_confirmed_at ?? null,
    pendingSecret: pendingIsFresh ? await safeDecrypt(row?.totp_pending_secret_encrypted) : null,
    lastStep: typeof row?.totp_last_step === 'number' ? row.totp_last_step : null,
  };
}

/**
 * Mint a secret and park it as PENDING.
 *
 * Nothing about the account changes here — `two_factor_enabled` is untouched.
 * The user has a QR code and no obligation; if they close the tab, the pending
 * secret ages out and they are exactly where they started.
 */
export async function beginTotpEnrolment(userId: string): Promise<string> {
  const secret = generateTotpSecret();
  const sb = createSupabaseServiceClient();
  await sb.from('user_security_settings').upsert(
    {
      user_id: userId,
      totp_pending_secret_encrypted: (await secretCipher()).encryptSecret(secret),
      totp_pending_started_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return secret;
}

export async function cancelTotpEnrolment(userId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('user_security_settings')
    .update({ totp_pending_secret_encrypted: null, totp_pending_started_at: null })
    .eq('user_id', userId);
}

export type EnrolmentResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'no_pending' | TotpFailure };

/**
 * Turn the pending secret into a real one — but only on a code that works.
 *
 * This is the step that stops somebody locking themselves out. A scan that went
 * to the wrong app, a phone whose clock is an hour out, a screenshot never
 * actually imported: all of them look identical up to here, and all of them are
 * caught by making the person prove once that they can produce a code.
 */
export async function confirmTotpEnrolment(userId: string, code: string): Promise<EnrolmentResult> {
  const state = await getUserTwoFactorState(userId);
  if (!state.pendingSecret) return { ok: false, reason: 'no_pending' };

  const verification = verifyTotpCode(state.pendingSecret, code, { lastStep: null });
  if (!verification.ok) return { ok: false, reason: verification.reason ?? 'incorrect' };

  const now = new Date().toISOString();
  const sb = createSupabaseServiceClient();
  await sb.from('user_security_settings').upsert(
    {
      user_id: userId,
      two_factor_enabled: true,
      two_factor_method: 'totp',
      two_factor_verified_at: now,
      totp_secret_encrypted: (await secretCipher()).encryptSecret(state.pendingSecret),
      totp_pending_secret_encrypted: null,
      totp_pending_started_at: null,
      totp_confirmed_at: now,
      totp_last_step: verification.step,
      // The emailed-code fields from 0018 belong to the other method; leaving a
      // half-finished email challenge lying about would let it be completed.
      pending_code_hash: null,
      pending_expires_at: null,
    },
    { onConflict: 'user_id' },
  );

  const recoveryCodes = await replaceRecoveryCodes(userId);
  return { ok: true, recoveryCodes };
}

/**
 * Issue a fresh set of recovery codes and retire every earlier one.
 *
 * Returns the plaintext. This is the ONLY moment it exists — the caller shows
 * it once and it is unrecoverable afterwards, which is the point: a code that
 * can be fetched again is a password, not a recovery code.
 */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const sb = createSupabaseServiceClient();
  await sb.from('user_recovery_codes').delete().eq('user_id', userId);
  await sb
    .from('user_recovery_codes')
    .insert(codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(code) })));
  return codes;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count } = await sb
    .from('user_recovery_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('used_at', null);
  return count ?? 0;
}

/** Take the user's second factor off. Callers are responsible for the audit row. */
export async function disableTotpForUser(userId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('user_security_settings')
    .update({
      two_factor_enabled: false,
      two_factor_method: 'email',
      totp_secret_encrypted: null,
      totp_pending_secret_encrypted: null,
      totp_pending_started_at: null,
      totp_confirmed_at: null,
      totp_last_step: null,
    })
    .eq('user_id', userId);
  await sb.from('user_recovery_codes').delete().eq('user_id', userId);
}

export type ChallengeResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesRemaining: number }
  | { ok: false; reason: 'not_enrolled' | 'unreadable_secret' | TotpFailure };

/**
 * The sign-in challenge: a TOTP code, or one recovery code spent for good.
 *
 * The accepted step is written back before this returns, so the same code
 * cannot be presented twice — including by a second request racing the first,
 * because the update is conditional on the step still being what we read.
 */
export async function verifyTwoFactorChallenge(
  userId: string,
  input: string,
): Promise<ChallengeResult> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('user_security_settings')
    .select(SECURITY_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  const row = (data ?? null) as SecuritySettingsRow | null;
  if (!row?.two_factor_enabled || row.two_factor_method !== 'totp') {
    return { ok: false, reason: 'not_enrolled' };
  }

  const trimmed = input.trim();
  const now = new Date().toISOString();

  // A recovery code is ten base32 characters; a TOTP code is six digits. The
  // shapes cannot collide, so one box accepts either and nobody has to find a
  // "use a backup code instead" link while locked out.
  const normalizedRecovery = normalizeRecoveryCode(trimmed);
  if (/^[A-Z2-7]{10}$/.test(normalizedRecovery)) {
    const hash = hashRecoveryCode(normalizedRecovery);
    const { data: spent } = await sb
      .from('user_recovery_codes')
      .update({ used_at: now })
      .eq('user_id', userId)
      .eq('code_hash', hash)
      .is('used_at', null)
      .select('id');
    if (spent && spent.length > 0) {
      await sb
        .from('user_security_settings')
        .update({ two_factor_verified_at: now })
        .eq('user_id', userId);
      return {
        ok: true,
        usedRecoveryCode: true,
        recoveryCodesRemaining: await countUnusedRecoveryCodes(userId),
      };
    }
    return { ok: false, reason: 'incorrect' };
  }

  const secret = await safeDecrypt(row.totp_secret_encrypted);
  if (!secret) return { ok: false, reason: 'unreadable_secret' };

  const lastStep = typeof row.totp_last_step === 'number' ? row.totp_last_step : null;
  const verification = verifyTotpCode(secret, trimmed, { lastStep });
  if (!verification.ok) return { ok: false, reason: verification.reason ?? 'incorrect' };

  // Conditional on the step we read. Two tabs submitting the same code at the
  // same instant both pass the arithmetic; only the one that wins this update
  // gets a row back, and the loser is told the code was already used.
  const claim = sb
    .from('user_security_settings')
    .update({ totp_last_step: verification.step, two_factor_verified_at: now })
    .eq('user_id', userId);
  const { data: claimed } = await (lastStep === null
    ? claim.is('totp_last_step', null)
    : claim.eq('totp_last_step', lastStep)
  ).select('user_id');
  if (!claimed || claimed.length === 0) return { ok: false, reason: 'reused' };

  return {
    ok: true,
    usedRecoveryCode: false,
    recoveryCodesRemaining: await countUnusedRecoveryCodes(userId),
  };
}

// ---------------------------------------------------------------------------
// The company policy
// ---------------------------------------------------------------------------

export interface CompanyTwoFactorPolicy {
  required: boolean;
  gracePeriodDays: number;
  requiredSince: string | null;
  /** When people who have not enrolled stop being nudged and start being stopped. */
  graceEndsAt: string | null;
}

export const TWO_FACTOR_POLICY_OFF: CompanyTwoFactorPolicy = {
  required: false,
  gracePeriodDays: 14,
  requiredSince: null,
  graceEndsAt: null,
};

/**
 * Read-through cache with a one-minute life.
 *
 * The session check runs on every page load in the product, and the file it
 * runs in already carries a note measuring a Supabase round trip on this
 * deployment at ~230 ms. Reading a single-row policy table that changes maybe
 * twice in a company's lifetime, on every request, would put that back.
 *
 * A minute of staleness is a deliberate trade and it is the safe direction on
 * both edges: turning the policy ON takes up to a minute to bite, and a policy
 * that starts with a grace period of days does not care; turning it OFF also
 * takes up to a minute, and the admin action clears this cache in its own
 * process so the person who pressed the button sees it immediately.
 */
const policyCache = new Map<string, { value: CompanyTwoFactorPolicy; expiresAt: number }>();
const POLICY_CACHE_MS = 60_000;

export function invalidateCompanyTwoFactorPolicy(companyId: string): void {
  policyCache.delete(companyId);
}

export async function getCompanyTwoFactorPolicy(
  companyId: string,
  options: { fresh?: boolean } = {},
): Promise<CompanyTwoFactorPolicy> {
  const cached = policyCache.get(companyId);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_two_factor_policies')
    .select('required,grace_period_days,required_since')
    .eq('company_id', companyId)
    .maybeSingle();

  const value = shapePolicyRow(data);
  policyCache.set(companyId, { value, expiresAt: Date.now() + POLICY_CACHE_MS });
  return value;
}

interface RawPolicyRow {
  required?: boolean | null;
  grace_period_days?: number | null;
  required_since?: string | null;
}

/** No row means the company has never touched this setting, which means off. */
function shapePolicyRow(value: unknown): CompanyTwoFactorPolicy {
  const row = (Array.isArray(value) ? value[0] : value) as RawPolicyRow | null | undefined;
  const gracePeriodDays = typeof row?.grace_period_days === 'number' ? row.grace_period_days : 14;
  const requiredSince = row?.required_since ?? null;
  return {
    required: Boolean(row?.required),
    gracePeriodDays,
    requiredSince,
    graceEndsAt:
      row?.required && requiredSince
        ? new Date(Date.parse(requiredSince) + gracePeriodDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
  };
}

/**
 * The policy out of a membership row that was fetched with it embedded.
 *
 * This exists so the session check can learn the policy for FREE. That check is
 * budgeted at two round trips — `auth.getUser()` plus one embedded profile read
 * — and `scripts/test-query-counts.mjs` asserts it, because a Supabase round
 * trip costs ~230 ms on this deployment and an extra one on every page load is
 * a quarter of a second of blank screen for everybody, to answer a question
 * that is "no" for almost every company.
 *
 * So the policy rides along inside the embed the session check already makes,
 * and this untangles whatever PostgREST returned:
 *
 *   company_users(company_id,role,created_at,
 *                 companies(company_two_factor_policies(required,
 *                                                       grace_period_days,
 *                                                       required_since)))
 *
 * Either level can come back as an object or a single-element array depending on
 * how PostgREST reads the relationship, and either can be null when there is no
 * row. All of those mean the same thing here, and an absent policy is "off" —
 * which is also the safe direction to be wrong in.
 */
export function policyFromMembershipRow(membership: unknown): CompanyTwoFactorPolicy {
  const row = (Array.isArray(membership) ? membership[0] : membership) as
    | Record<string, unknown>
    | null
    | undefined;
  const company = (Array.isArray(row?.companies) ? row?.companies[0] : row?.companies) as
    | Record<string, unknown>
    | null
    | undefined;
  return shapePolicyRow(company?.company_two_factor_policies);
}

export type TwoFactorGate = 'ok' | 'challenge' | 'enrol';

/**
 * What the session check should do with this request.
 *
 *   'ok'         — carry on.
 *   'challenge'  — they hold a second factor and it has not been proved lately.
 *   'enrol'      — their company requires one, and the grace period has run out.
 *
 * Reading the order here matters. A user who is enrolled is settled without
 * touching the policy at all, so the common path costs nothing.
 *
 * `policy` is how this stays free. Pass it — including as `null`, meaning "I
 * looked and there is no policy row" — and no query is made. Leave it
 * `undefined` and the policy is read here, cached for a minute. The session
 * check embeds it in the read it already makes and so always passes it; the
 * degraded fallback path in that same file does not, and pays for a read.
 *
 * The 'enrol' branch cannot fire for a user with no company, and it cannot fire
 * inside the grace window. Nothing here ever switches 2FA ON for anybody — it
 * only decides whether to ask.
 */
export async function resolveTwoFactorGate(params: {
  companyId: string | null;
  enabled: boolean;
  method: string | null;
  verifiedAt: string | null;
  policy?: CompanyTwoFactorPolicy | null;
  nowMs?: number;
}): Promise<TwoFactorGate> {
  const now = params.nowMs ?? Date.now();

  if (params.enabled) {
    const verifiedAt = params.verifiedAt ? Date.parse(params.verifiedAt) : 0;
    if (!verifiedAt || now - verifiedAt > TWO_FACTOR_SESSION_MAX_AGE_MS) return 'challenge';
    return 'ok';
  }

  if (!params.companyId) return 'ok';
  const policy =
    params.policy !== undefined
      ? (params.policy ?? TWO_FACTOR_POLICY_OFF)
      : await getCompanyTwoFactorPolicy(params.companyId);
  if (!policy.required || !policy.graceEndsAt) return 'ok';
  return Date.parse(policy.graceEndsAt) <= now ? 'enrol' : 'ok';
}
