import { z } from 'zod';

/**
 * Centralized, validated environment access.
 *
 * Module 1 (Project Foundation) requirement: "environment variable validation".
 * Import `env` anywhere instead of reading `process.env` directly so that a
 * missing/invalid variable fails fast at boot with a readable error.
 *
 * Only NEXT_PUBLIC_* values are safe to reference in client components.
 */
const stringMin = (msg: string) => z.string().min(1, msg);

const serverSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: stringMin('NEXT_PUBLIC_SUPABASE_URL is required').url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stringMin('NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),

  // AI providers (at least one enforced by refine below)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GROK_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),

  // Default AI settings
  DEFAULT_CHAT_PROVIDER: z.string().default('openai'),
  DEFAULT_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  DEFAULT_ADVANCED_CHAT_MODEL: z.string().default('gpt-4o'),
  DEFAULT_EMBEDDING_PROVIDER: z.string().default('openai'),
  DEFAULT_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  DEFAULT_RERANK_PROVIDER: z.string().default('cohere'),
  DEFAULT_RERANK_MODEL: z.string().default('rerank-multilingual-v3.0'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Trigger.dev
  TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_PROJECT_ID: z.string().optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Integrations
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  SHOPIFY_SCOPES: z.string().optional(),
  WOOCOMMERCE_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Security
  ENCRYPTION_KEY: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  ADMIN_SUPPORT_ACCESS_REQUIRED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Optional infra
  REDIS_URL: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_WIDGET_URL: z.string().default('http://localhost:3000/widget/widget.js'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

/**
 * Server-only env. Reading this on the client throws.
 */
function loadServerEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('`serverEnv` must not be imported in client components.');
  }
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`❌ Invalid server environment variables:\n${format(parsed.error)}`);
  }
  const data = parsed.data;
  return data;
}

function loadClientEnv() {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_WIDGET_URL: process.env.NEXT_PUBLIC_WIDGET_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    throw new Error(`❌ Invalid client environment variables:\n${format(parsed.error)}`);
  }
  return parsed.data;
}

/** Public (browser-safe) env — always available. */
export const env = loadClientEnv();

/**
 * Server env — lazy so importing this module in a client bundle does not crash.
 * Call `serverEnv()` only inside route handlers, server components, or jobs.
 */
let _serverEnv: ReturnType<typeof loadServerEnv> | null = null;
export function serverEnv() {
  if (!_serverEnv) _serverEnv = loadServerEnv();
  return _serverEnv;
}
