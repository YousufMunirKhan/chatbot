-- Migration 0047 - Repair quick action audience tags for legacy hybrid bots.
--
-- Migration 0036 treated the legacy `help_desk` capability as enough to mark
-- a bot internal. Some customer-facing hybrid bots carried that capability, so
-- their normal website pills were incorrectly moved to the internal audience.
-- From here on, explicit assistant audience, bot_type, and internal_* caps are
-- the internal signal.

with customer_bots as (
  select b.id
  from public.bots b
  where coalesce(b.appearance_json->>'assistantAudience', 'customer') <> 'internal'
    and b.bot_type <> 'help_desk'
    and not exists (
      select 1
      from unnest(b.capability_flags) cap(value)
      where cap.value like 'internal_%'
    )
)
update public.bot_quick_actions qa
set audience = 'customer',
    source = 'default'
from customer_bots cb
where qa.bot_id = cb.id
  and qa.action_config_json->>'defaultKey' in (
    'lead_form',
    'appointment_form',
    'human_handoff',
    'track_order',
    'browse_products'
  );

update public.bot_quick_actions
set audience = 'internal',
    source = 'default'
where action_config_json->>'defaultKey' in (
  'helpdesk_add_product',
  'helpdesk_check_stock',
  'helpdesk_update_price',
  'helpdesk_purchase_order',
  'helpdesk_daily_sales',
  'helpdesk_low_stock'
);

update public.bot_quick_actions
set audience = 'internal'
where source = 'connector';
