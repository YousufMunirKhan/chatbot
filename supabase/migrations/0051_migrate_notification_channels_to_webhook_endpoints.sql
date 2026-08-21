-- ===========================================================================
-- Migration 0051 — Move notification-settings Slack / generic webhooks into
--                  webhook_endpoints (Module 24 → Module 26 consolidation)
--
-- WHY: two systems delivered the same events. `webhook_endpoints`
-- (/company/webhooks) and the `slack_enabled` / `webhook_enabled` channels on
-- `company_notification_settings` (/company/notifications?tab=settings) are
-- driven by the same notify() call, so a company that configured both screens
-- received every lead, order and ticket alert twice. The application now
-- suppresses the settings-side channel whenever an active endpoint already
-- covers the event (see src/lib/notify.ts), which stops the duplicates. This
-- migration is the second half: it copies the still-settings-only companies
-- into `webhook_endpoints` so they keep their alerts once the settings fields
-- are removed from the UI.
--
-- ORDER OF OPERATIONS — this migration MUST run in production BEFORE the
-- Slack / generic-webhook fields are deleted from the notification settings
-- form and from `company_notification_settings`. Deleting them first silently
-- switches off alerts for every company that only ever configured that screen.
--
-- IDEMPOTENT: a company is migrated only if it has NO `webhook_endpoints` row
-- of that kind yet. Re-running is a no-op, and a company that already has its
-- own Slack (or generic) endpoint is left alone — copying its settings row on
-- top would create a SECOND endpoint pointing at the same Slack URL and
-- reintroduce the exact duplicate-alert bug this work removes.
--
-- NOTES / DELIBERATE LIMITS:
--   * URLs are copied as ciphertext. Both tables encrypt with the same
--     AES-256-GCM app key (src/lib/crypto.ts), so the copied value decrypts
--     unchanged — no plaintext ever touches this migration or the logs.
--   * `url_preview` cannot be computed here (the URL is encrypted), so it gets
--     a placeholder. The company can relabel from /company/webhooks.
--   * `missed_conversation` has no public webhook event in NOTIFICATION_TO_EVENT
--     and is therefore NOT carried over. Companies relying on it via Slack must
--     keep using the settings channel until an event name exists for it.
--   * Generic endpoints are created INACTIVE on purpose. The two systems do not
--     speak the same wire format: the settings channel signs with the company's
--     own secret under `X-SwitchSave-Signature` and posts a `{..., sentAt}`
--     envelope, while endpoints sign under `X-Webhook-Signature: sha256=…` and
--     post a `{..., created_at}` envelope. The signing secret also cannot be
--     carried across (encrypted at rest in settings, plaintext in
--     webhook_endpoints), so a fresh one is generated. Activating a generic
--     endpoint is a breaking change for the receiver and must be a human
--     decision — until it is activated the settings channel keeps delivering,
--     so nothing is lost in the meantime. Slack rows have no such contract
--     (both systems POST `{text}`) and are created active.
--   * Per-plan endpoint caps (planWebhookLimits) are enforced on create in the
--     UI only; a migrated row may put a company one over its cap. Existing rows
--     keep working — accepted rather than dropping a company's alerts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Slack — active, the wire format is identical on both sides.
-- ---------------------------------------------------------------------------
with event_map (notification_type, webhook_event) as (
  -- Mirrors NOTIFICATION_TO_EVENT in src/lib/webhooks.ts.
  values
    ('new_lead', 'lead.created'),
    ('new_appointment', 'appointment.created'),
    ('new_order', 'order.created'),
    ('human_takeover', 'ticket.created'),
    ('helpdesk_issue_reported', 'ticket.created'),
    ('helpdesk_issue_resolved', 'ticket.resolved')
),
candidates as (
  select
    s.company_id,
    s.slack_webhook_encrypted,
    array_agg(distinct m.webhook_event) as events
  from public.company_notification_settings s
  cross join event_map m
  where s.slack_enabled
    and coalesce(s.slack_webhook_encrypted, '') <> ''
    -- Mirrors channelAllowed(): an explicit boolean in event_rules_json wins,
    -- otherwise the event defaults on (every mapped type is a core event).
    and case jsonb_typeof(s.event_rules_json -> m.notification_type -> 'slack')
          when 'boolean' then (s.event_rules_json -> m.notification_type ->> 'slack')::boolean
          else true
        end
    and not exists (
      select 1
      from public.webhook_endpoints w
      where w.company_id = s.company_id
        and w.kind = 'slack'
    )
  group by s.company_id, s.slack_webhook_encrypted
)
insert into public.webhook_endpoints (
  company_id, kind, url_encrypted, url_preview, secret, events, active, label
)
select
  c.company_id,
  'slack',
  c.slack_webhook_encrypted,
  'hooks.slack.com/… (migrated)',
  null,
  c.events,
  true,
  'Slack (migrated from notification settings)'
from candidates c;

-- ---------------------------------------------------------------------------
-- Generic webhook — created INACTIVE, see NOTES above.
-- ---------------------------------------------------------------------------
with event_map (notification_type, webhook_event) as (
  values
    ('new_lead', 'lead.created'),
    ('new_appointment', 'appointment.created'),
    ('new_order', 'order.created'),
    ('human_takeover', 'ticket.created'),
    ('helpdesk_issue_reported', 'ticket.created'),
    ('helpdesk_issue_resolved', 'ticket.resolved')
),
candidates as (
  select
    s.company_id,
    s.generic_webhook_url_encrypted,
    array_agg(distinct m.webhook_event) as events
  from public.company_notification_settings s
  cross join event_map m
  where s.webhook_enabled
    and coalesce(s.generic_webhook_url_encrypted, '') <> ''
    and case jsonb_typeof(s.event_rules_json -> m.notification_type -> 'webhook')
          when 'boolean' then (s.event_rules_json -> m.notification_type ->> 'webhook')::boolean
          else true
        end
    and not exists (
      select 1
      from public.webhook_endpoints w
      where w.company_id = s.company_id
        and w.kind = 'generic'
    )
  group by s.company_id, s.generic_webhook_url_encrypted
)
insert into public.webhook_endpoints (
  company_id, kind, url_encrypted, url_preview, secret, events, active, label
)
select
  c.company_id,
  'generic',
  c.generic_webhook_url_encrypted,
  'Migrated from notification settings',
  -- Matches newSigningSecret() in src/lib/webhooks.ts. The old secret cannot be
  -- reused: it is encrypted at rest in company_notification_settings while this
  -- column holds plaintext. The company must copy the new secret from
  -- /company/webhooks before activating the endpoint.
  'whsec_' || encode(gen_random_bytes(24), 'hex'),
  c.events,
  false,
  'Webhook (migrated from notification settings)'
from candidates c;
