import { listDocuments } from './knowledge-data';
import { getBusinessMemory } from './business-profile-data';
import { getCurrentCompany, listBots, listMembers } from './data';
import { catalogCounts } from './integrations-data';
import { SETUP_STEP_COPY } from '@/lib/constants';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  complete: boolean;
  detail: string;
}

export interface CompanySetupProgress {
  /** Scopes any client-side wizard state so it cannot leak across companies. */
  companyId: string;
  companyName: string;
  percent: number;
  complete: number;
  total: number;
  nextStep: SetupStep | null;
  steps: SetupStep[];
  /**
   * The website import that already happened, if one did.
   *
   * The setup page asked for a website address every time it was opened, even
   * with "Your website is connected" ticked two inches above it — so it read as
   * a job still to do, on a page whose whole purpose is telling you what is
   * left.
   *
   * This is the ONLY definition of "we have read their site" in the product.
   * `companies.website` is not a substitute and never was: an operator can type
   * an address onto a company that has never been crawled, and the first live
   * tenant is exactly that — a website recorded, zero documents. Anything that
   * decides whether to ask for the address (the checklist step, the home-page
   * prompt) reads this, so the two can never disagree.
   */
  websiteImport: { title: string; importedAt: string } | null;
  /**
   * The address on file, for prefilling the ask. Not evidence of an import —
   * see above — only a sensible default so the owner confirms rather than types.
   */
  websiteAddress: string | null;
  stats: {
    bots: number;
    knowledgeDocs: number;
    teamMembers: number;
    businessReadiness: number;
  };
  customerReadiness: CustomerBotReadiness;
}

export interface CustomerCapabilityReadiness {
  key: string;
  label: string;
  enabled: boolean;
  ready: boolean;
  missing: string[];
  href: string;
}

export interface CustomerBotReadiness {
  hasCustomerBot: boolean;
  selectedCapabilities: string[];
  enabledCount: number;
  readyCount: number;
  percent: number;
  capabilities: CustomerCapabilityReadiness[];
  missingCritical: string[];
  testScenarios: string[];
}

export async function getCompanySetupProgress(): Promise<CompanySetupProgress> {
  const [company, bots, members, memory, docs, catalog] = await Promise.all([
    getCurrentCompany(),
    listBots(),
    listMembers(),
    getBusinessMemory(),
    listDocuments(),
    catalogCounts(),
  ]);

  const hasContact = Boolean(
    memory.profile.primaryPhone ||
      memory.profile.supportEmail ||
      memory.profile.salesEmail ||
      memory.profile.whatsapp,
  );
  const hasBusinessBasics = Boolean(
    company.website ||
      memory.profile.shortDescription ||
      memory.profile.industry ||
      hasContact,
  );
  const businessDataCount =
    memory.locations.length +
    memory.services.length +
    memory.policies.length +
    memory.faqs.length;
  const hasBusinessData = businessDataCount > 0 || memory.readiness.percent >= 50;
  const hasAssistant = bots.length > 0;
  const hasCapabilities = bots.some((bot) => bot.capabilityFlags.length > 0);
  const hasKnowledge = docs.length > 0 || memory.faqs.length > 0 || memory.policies.length > 0;
  const hasRequiredData = hasBusinessBasics && (hasBusinessData || hasKnowledge);
  const canTest = hasAssistant && hasCapabilities && hasRequiredData;
  const widgetInstalled = bots.some((bot) => bot.domainAllowlist.length > 0);
  const customerBots = bots.filter((bot) => bot.assistantAudience === 'customer');
  const customerCapabilities = new Set(customerBots.flatMap((bot) => bot.capabilityFlags));
  const hasCustomerBot = customerBots.length > 0;
  const hasOpenHours = memory.hours.some((h) => h.isClosed || (h.openTime && h.closeTime));
  const hasCatalogue = catalog.products > 0 || catalog.menuItems > 0;
  const hasLiveProductSource = hasCatalogue;
  const hasOrderData = catalog.orders > 0;
  const hasLeadRules = Boolean(memory.profile.leadQualificationRules);
  const hasAppointmentRules = Boolean(memory.profile.appointmentRules);
  const hasAppointmentAvailability = hasOpenHours || hasAppointmentRules;
  const hasPaymentRules = memory.profile.paymentMethods.length > 0;
  const hasHandoffRules = Boolean(memory.profile.escalationRules);
  const hasTeamForHandoff = members.length > 1 || Boolean(memory.profile.supportEmail || memory.profile.primaryPhone || memory.profile.whatsapp);
  const hasSupportKnowledge = hasKnowledge || docs.length > 0;

  const capabilityDefinitions: Array<{
    key: string;
    label: string;
    href: string;
    checks: Array<[boolean, string]>;
    test: string;
  }> = [
    {
      key: 'sales_agent',
      label: 'Sales answers',
      href: '/company/business-data?tab=services',
      checks: [
        [Boolean(memory.services.length || hasCatalogue), 'Add services, offers, products, or a connected catalogue'],
        [Boolean(memory.profile.uniqueSellingPoints || memory.profile.shortDescription), 'Add a short business description or selling points'],
      ],
      test: 'Ask for a recommendation and confirm it uses real services, offers, or products.',
    },
    {
      key: 'lead_capture',
      label: 'Lead capture',
      href: '/company/business-data?tab=basics',
      checks: [
        [hasContact, 'Add phone, email, or WhatsApp for follow-up'],
        [hasLeadRules, 'Add lead qualification rules or fields'],
      ],
      test: 'Ask for pricing or a callback and confirm the bot collects useful lead details.',
    },
    {
      key: 'appointment_booking',
      label: 'Demo / appointment requests',
      href: '/company/business-data?tab=services',
      checks: [
        [Boolean(memory.services.length), 'Add the options visitors can request, for example demo, installation, support visit, or consultation'],
        [hasAppointmentAvailability, 'Add availability rules, opening hours, or how your team confirms requests'],
        [hasContact, 'Add phone, email, or WhatsApp so the team can confirm the request'],
      ],
      test: 'Ask to book a demo or appointment and confirm the bot collects the option, date/time preference, and contact details.',
    },
    {
      key: 'help_desk',
      label: 'Customer support FAQs',
      href: '/company/business-data?tab=faqs',
      checks: [
        [hasSupportKnowledge, 'Add FAQs, policies, or knowledge documents'],
        [Boolean(memory.policies.length || memory.faqs.length), 'Add approved policy or FAQ answers'],
      ],
      test: 'Ask a refund, delivery, or support question and confirm the answer comes from saved facts.',
    },
    {
      key: 'product_stock_assistant',
      label: 'Product and stock answers',
      href: '/company/integrations',
      checks: [
        [hasCatalogue, 'Connect/import products or menu items'],
        [hasLiveProductSource, 'Use Shopify, WordPress/WooCommerce, CSV refresh, Custom API, or a connector for current prices and stock'],
      ],
      test: 'Ask for a product price or availability and confirm the bot does not guess.',
    },
    {
      key: 'order_tracking',
      label: 'Order tracking',
      href: '/company/integrations',
      checks: [
        [hasOrderData, 'Connect/import order data or an order integration'],
      ],
      test: 'Ask for order status and confirm the bot requires order number plus phone or email.',
    },
    {
      key: 'order_placement',
      label: 'Order placement',
      href: '/company/business-data?tab=policies',
      checks: [
        [hasCatalogue, 'Connect/import products or menu items'],
        [hasPaymentRules, 'Add payment methods'],
        [Boolean(memory.policies.length), 'Add delivery, pickup, cancellation, or order policy'],
      ],
      test: 'Build a cart and confirm the bot shows a summary before creating an order.',
    },
    {
      key: 'human_agent_takeover',
      label: 'Human handoff',
      href: '/company/business-data?tab=basics',
      checks: [
        [hasTeamForHandoff, 'Add a support contact or team member'],
        [hasHandoffRules, 'Add escalation and handoff rules'],
      ],
      test: 'Ask for a human and confirm the conversation is routed or contact details are collected.',
    },
    {
      key: 'live_chat',
      label: 'Live chat takeover',
      href: '/company/agents',
      checks: [
        [members.length > 1, 'Invite at least one agent for live takeover'],
      ],
      test: 'Start a preview conversation and confirm an agent can take over from the inbox.',
    },
  ];

  const customerCapabilityReadiness = capabilityDefinitions.map((cap) => {
    const enabled = customerCapabilities.has(cap.key);
    const missing = cap.checks.filter(([complete]) => !complete).map(([, message]) => message);
    return {
      key: cap.key,
      label: cap.label,
      enabled,
      ready: enabled && missing.length === 0,
      missing,
      href: cap.href,
    };
  });
  const enabledCustomerCapabilities = customerCapabilityReadiness.filter((cap) => cap.enabled);
  const readyCustomerCapabilities = enabledCustomerCapabilities.filter((cap) => cap.ready);
  const missingCritical = [
    ...(hasCustomerBot ? [] : ['Create a customer-facing assistant']),
    ...(hasCustomerBot && customerCapabilities.size === 0 ? ['Select customer bot capabilities'] : []),
    ...enabledCustomerCapabilities.flatMap((cap) => cap.missing.map((item) => `${cap.label}: ${item}`)),
  ];
  const testScenarios = capabilityDefinitions
    .filter((cap) => customerCapabilities.has(cap.key))
    .map((cap) => cap.test);
  if (hasCustomerBot) {
    testScenarios.push('Ask a question that is not in the knowledge base and confirm the bot admits it is missing.');
  }
  const customerReadiness: CustomerBotReadiness = {
    hasCustomerBot,
    selectedCapabilities: Array.from(customerCapabilities),
    enabledCount: enabledCustomerCapabilities.length,
    readyCount: readyCustomerCapabilities.length,
    percent:
      enabledCustomerCapabilities.length === 0
        ? 0
        : Math.round((readyCustomerCapabilities.length / enabledCustomerCapabilities.length) * 100),
    capabilities: customerCapabilityReadiness,
    missingCritical: missingCritical.slice(0, 8),
    testScenarios,
  };

  // `sourceType` is 'url' for anything the crawler brought in.
  const imported = docs.filter((d) => d.sourceType === 'url');
  const newestImport = imported.length
    ? imported.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    : null;
  const websiteOnRecord = (company.website ?? '').trim();

  /**
   * When the website step counts as finished.
   *
   * An import is the real answer. The second clause is what stops the step
   * trapping the businesses that have no website — a hard gate there would leave
   * them permanently one short of a finished checklist, and a checklist that can
   * never go green is one nobody comes back to.
   *
   * It is deliberately narrow. A company with an address on file that we have
   * never read is NOT let off: there is real material sitting there, and that is
   * precisely the case the owner complained about. Only a company with no
   * address at all, which has gone and supplied those same facts itself, is
   * treated as having nothing left to import. It genuinely has not.
   *
   * Derived, so there is no "I have no website" flag to store, drift, or migrate.
   * The one genuinely non-derivable thing — "I have seen this and not today" —
   * stays where the guide already keeps that kind of intent, in the browser.
   */
  const websiteStepComplete = newestImport !== null || (!websiteOnRecord && hasRequiredData);

  const steps: SetupStep[] = [
    {
      key: 'website',
      ...SETUP_STEP_COPY['website']!,
      // The guided screen, because the import happens inline on it. There is no
      // separate page that owns this job to send anybody to.
      href: '/company/setup/guide?step=website',
      complete: websiteStepComplete,
      detail: newestImport
        ? `${imported.length} page${imported.length === 1 ? '' : 's'} read from your website`
        : websiteStepComplete
          ? 'No website — you added your details yourself'
          : websiteOnRecord
            ? `We have ${websiteOnRecord} on file but have not read it yet`
            : 'We have not read your website yet',
    },
    {
      key: 'purpose',
      ...SETUP_STEP_COPY['purpose']!,
      href: hasAssistant ? '/company/bots' : '/company/bots/new',
      complete: hasAssistant,
      detail: hasAssistant ? `${bots.length} assistant${bots.length === 1 ? '' : 's'} created` : 'You have not made one yet',
    },
    {
      key: 'capabilities',
      ...SETUP_STEP_COPY['capabilities']!,
      href: hasAssistant ? '/company/bots' : '/company/bots/new',
      complete: hasCapabilities,
      detail: hasCapabilities ? 'Jobs picked' : 'Nothing picked yet',
    },
    {
      key: 'required-data',
      ...SETUP_STEP_COPY['required-data']!,
      href: '/company/business-data',
      complete: hasRequiredData,
      detail: hasRequiredData
        ? `${businessDataCount} thing${businessDataCount === 1 ? '' : 's'} saved, ${docs.length} file${docs.length === 1 ? '' : 's'} uploaded`
        : 'Some facts are still missing',
    },
    {
      key: 'test',
      // Anchored at the live "Test your assistant" tool. The design preview on
      // this page is a mock, so linking at the page alone left the step untestable.
      ...SETUP_STEP_COPY['test']!,
      href: '/company/widget#test-assistant',
      complete: canTest,
      detail: canTest ? 'Ready — ask it something' : 'Finish the three steps above first',
    },
    {
      key: 'install',
      ...SETUP_STEP_COPY['install']!,
      href: '/company/widget',
      complete: widgetInstalled,
      detail: widgetInstalled ? 'Your website is connected' : 'Not on your website yet',
    },
  ];

  const complete = steps.filter((step) => step.complete).length;
  const total = steps.length;

  return {
    companyId: company.id,
    companyName: company.name,
    percent: Math.round((complete / total) * 100),
    complete,
    total,
    nextStep: steps.find((step) => !step.complete) ?? null,
    steps,
    websiteImport: newestImport
      ? { title: newestImport.title, importedAt: newestImport.createdAt }
      : null,
    websiteAddress: websiteOnRecord || null,
    stats: {
      bots: bots.length,
      knowledgeDocs: docs.length,
      teamMembers: members.length,
      businessReadiness: memory.readiness.percent,
    },
    customerReadiness,
  };
}
