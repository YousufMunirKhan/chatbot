/**
 * WhatsApp account-standing playbooks, as data.
 *
 * Two things every serious WhatsApp seller asks for and nobody documents in
 * one place: how to actually get the green/blue verified badge, and how to
 * move a live number off another BSP without losing message history or
 * template approvals. Rendered as persistable checklists (see
 * `whatsapp_guide_progress`) because both processes run over days or weeks.
 */

export type GuideKey = 'blue_tick' | 'bsp_migration';

export interface GuideStep {
  /** Stable id — persisted in whatsapp_guide_progress.step_key, never renamed. */
  key: string;
  title: string;
  detail: string;
  /** Where the work happens, when it is outside this dashboard. */
  where?: string;
}

export interface Guide {
  key: GuideKey;
  title: string;
  summary: string;
  /** Realistic elapsed time, so nobody opens a support ticket on day two. */
  duration: string;
  steps: GuideStep[];
}

export const BLUE_TICK_GUIDE: Guide = {
  key: 'blue_tick',
  title: 'Apply for the verified badge (green / blue tick)',
  summary:
    'The badge is granted to the Meta Business Account behind the number, not to the number itself. Meta reviews notability and business verification, so the paperwork below is the actual gate — the application form takes two minutes.',
  duration: 'Typically 2–6 weeks end to end',
  steps: [
    {
      key: 'business_verification',
      title: 'Complete Meta Business Verification',
      detail:
        'Submit your commercial registration / trade licence, a utility bill or bank statement showing the legal name and address, and a phone or domain you control. Every later step is blocked until this shows "Verified".',
      where: 'business.facebook.com → Business settings → Security Centre',
    },
    {
      key: 'display_name',
      title: 'Get the display name approved',
      detail:
        'The WhatsApp display name must match your real brand and follow Meta\'s display-name policy (no generic words like "Support" or "Delivery" on their own, no URLs, no promotional text). A rejected name is the single most common cause of a rejected badge.',
      where: 'WhatsApp Manager → Phone numbers → Display name',
    },
    {
      key: 'quality_green',
      title: 'Reach and hold a GREEN quality rating',
      detail:
        'Meta will not verify a number that is being blocked or reported. Send only to opted-in contacts, keep templates useful, and watch the Account status card above for a week before applying.',
      where: 'This page → Account status',
    },
    {
      key: 'tier_scale',
      title: 'Scale past the starter messaging tier',
      detail:
        'Move beyond TIER_50 by sending consistent, high-quality traffic. A number stuck at the starter tier reads as unused and rarely clears review.',
    },
    {
      key: 'notability',
      title: 'Gather notability evidence',
      detail:
        'Collect 3–5 links to coverage of your business in independent, well-known publications (not press releases, not paid placements, not your own blog). This is what the reviewer actually weighs.',
    },
    {
      key: 'submit_request',
      title: 'Submit the verification request',
      detail:
        'Open the business account, choose the country and category, attach the notability links and official documents, and submit. Fix the exact reason given if it is declined.',
      where: 'business.facebook.com → Business settings → Business info → Verification',
    },
    {
      key: 'appeal',
      title: 'If declined, wait 30 days and strengthen the evidence',
      detail:
        'Meta allows a re-application after 30 days. Re-submitting the same evidence is declined again — add new press coverage or correct the flagged document first.',
    },
  ],
};

export const BSP_MIGRATION_GUIDE: Guide = {
  key: 'bsp_migration',
  title: 'Migrate a live number from another BSP',
  summary:
    'Moving a number from Twilio, 360dialog, Wati, Gupshup or an in-house Cloud API app to this platform. Done in this order the number keeps its display name, quality rating and approved templates, and downtime is a few minutes.',
  duration: 'About 1–2 hours, plus a 24h template re-sync',
  steps: [
    {
      key: 'export_templates',
      title: 'Export your approved templates from the old provider',
      detail:
        'Copy the name, language, category and exact body text of every approved template. Template approvals travel with the WABA, not the BSP, but you need the list to verify nothing was lost.',
    },
    {
      key: 'export_contacts',
      title: 'Export contacts and opt-in records',
      detail:
        'Pull the subscriber list and the consent timestamps. Import them on the Subscribers page so opt-outs keep being honoured after the cut-over — a lost opt-out is a policy violation.',
      where: 'This app → WhatsApp → Subscribers',
    },
    {
      key: 'two_factor_off',
      title: 'Disable two-step verification on the number',
      detail:
        'The migration fails with a PIN error if two-step verification is still on. Turn it off in the old provider\'s dashboard (or via the API) immediately before you start.',
    },
    {
      key: 'business_manager_access',
      title: 'Take ownership of the WABA in Business Manager',
      detail:
        'Make sure your own Meta Business Account owns the WhatsApp Business Account — if the old BSP owns it, request an ownership transfer first, otherwise you are moving the number without its history.',
      where: 'business.facebook.com → Business settings → Accounts → WhatsApp accounts',
    },
    {
      key: 'initiate_migration',
      title: 'Start the migration and verify the number',
      detail:
        'In WhatsApp Manager, add the existing number to the destination WABA and complete SMS or voice verification. The number stops receiving on the old provider at this moment — schedule it outside business hours.',
      where: 'WhatsApp Manager → Phone numbers → Add phone number',
    },
    {
      key: 'connect_here',
      title: 'Connect the number in this dashboard',
      detail:
        'Add the Phone number ID and a permanent System User access token with whatsapp_business_messaging and whatsapp_business_management, then point the Meta webhook at this app.',
      where: 'This app → Channels',
    },
    {
      key: 'verify_templates',
      title: 'Sync templates and send a test',
      detail:
        'Run Sync from Meta on the Templates page and compare against your export. Send one template message to your own number, then reply to it to confirm inbound routing works.',
      where: 'This app → WhatsApp → Templates',
    },
    {
      key: 'decommission',
      title: 'Cancel the old BSP subscription',
      detail:
        'Only after a full day of clean inbound and outbound traffic. Keep the old dashboard read-only for 30 days in case you need historical transcripts.',
    },
  ],
};

export const WHATSAPP_GUIDES: Guide[] = [BLUE_TICK_GUIDE, BSP_MIGRATION_GUIDE];

export function getGuide(key: string): Guide | null {
  return WHATSAPP_GUIDES.find((g) => g.key === key) ?? null;
}
