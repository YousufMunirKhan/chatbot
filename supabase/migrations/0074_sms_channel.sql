-- ===========================================================================
-- Migration 0074 — SMS (Twilio) channel
--
-- The Twilio SMS adapter is wired into the channel registry and the generic
-- webhook route, so an inbound text now flows through the same pipeline as
-- every other channel: channel_identities → bot → processInboundMessage →
-- conversations. Two check constraints still refuse the new key, and each of
-- them fails a write the application has no way to recover from:
--
--   * channel_identities_channel_check — added in 0044 with the original four
--     channels and last widened in 0052 for Telegram/Viber/LINE/TikTok/YouTube.
--     Without 'sms' an admin connecting a Twilio number gets a raw Postgres
--     error from the upsert in createChannelIdentityAction.
--   * conversations_channel_check — added in 0044 and widened in 0052.
--     Without 'sms' the identity would save but the first inbound text would
--     fail on conversation insert, i.e. the channel would look connected and
--     silently answer nobody.
--
-- Both are widened by replacing the whole value list — a check constraint
-- cannot be extended in place — so the lists below repeat 0052's values
-- verbatim plus 'sms'. Widening a check never re-validates existing rows into
-- failure, so this is safe to run against live data.
-- ===========================================================================

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in (
    'web_chat','voice','whatsapp','instagram','facebook','email','phone','api',
    'telegram','viber','line','tiktok','youtube','sms'
  ));

alter table public.channel_identities drop constraint if exists channel_identities_channel_check;
alter table public.channel_identities
  add constraint channel_identities_channel_check
  check (channel in (
    'whatsapp','instagram','facebook','email',
    'telegram','viber','line','tiktok','youtube','sms'
  ));

-- contact_subscriptions already allows 'sms' (migration 0054), so STOP/START
-- keywords on a text message are recorded without any further change here.
-- channel_comment_events is deliberately untouched: SMS has no public feed.
