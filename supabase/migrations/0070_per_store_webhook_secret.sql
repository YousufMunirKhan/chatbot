-- ===========================================================================
-- Migration 0070 — Give each connected store its own webhook secret
--
-- Store webhooks were verified against a single platform-wide secret:
--
--   src/app/api/webhooks/store/[provider]/route.ts
--   return (provider === 'shopify' ? e.SHOPIFY_WEBHOOK_SECRET
--                                  : e.WOOCOMMERCE_WEBHOOK_SECRET) ?? null;
--
-- That cannot work here. Every customer connects their OWN shop with their own
-- credentials — the connect page asks each company for its store URL, consumer
-- key and consumer secret — and each shop signs its webhooks with a secret that
-- shop generated. One secret can only ever match one customer's shop.
--
-- The failure is silent, which is the worst part. A second customer connects a
-- store, their webhooks arrive signed with their own secret, the signature check
-- fails, and the request is rejected with a 401 that only ever appears in our
-- log. Their order automations simply never fire and nothing tells anybody.
--
-- `webhook_token` (migration 0055) already established the per-account pattern:
-- the webhook URL carries `?t=<token>`, unique platform-wide, so it resolves to
-- exactly one account. This adds the matching secret next to it, encrypted with
-- the same ENCRYPTION_KEY that protects every other stored credential — that key
-- is correctly platform-level, since it is the key the per-company secrets are
-- encrypted WITH.
--
-- The env values stay as a fallback so a single-tenant installation that already
-- has them keeps working. They are no longer the only answer.
-- ===========================================================================

alter table public.integration_accounts
  add column if not exists webhook_secret_encrypted text;

comment on column public.integration_accounts.webhook_secret_encrypted is
  'AES-256 ciphertext of this shop''s own webhook signing secret, written by '
  'src/lib/crypto.ts. Per account, because each customer''s shop signs with a '
  'secret that shop generated. Null falls back to the platform env secret.';
