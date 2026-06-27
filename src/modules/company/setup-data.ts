import { listDocuments } from './knowledge-data';
import { getBusinessMemory } from './business-profile-data';
import { getCurrentCompany, listBots, listMembers } from './data';
import { catalogCounts } from './integrations-data';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  complete: boolean;
  detail: string;
}

export interface CompanySetupProgress {
  companyName: string;
  percent: number;
  complete: number;
  total: number;
  nextStep: SetupStep | null;
  steps: SetupStep[];
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
      label: 'Appointment requests',
      href: '/company/business-data?tab=basics',
      checks: [
        [hasOpenHours, 'Add business hours'],
        [Boolean(memory.services.length), 'Add bookable services'],
        [hasAppointmentRules, 'Add appointment rules, duration, or confirmation process'],
      ],
      test: 'Ask to book a service and confirm the bot collects service, date, time, and contact details.',
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
        [hasLiveProductSource, 'Use Shopify, WooCommerce, CSV refresh, Custom API, or a connector for current prices and stock'],
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

  const steps: SetupStep[] = [
    {
      key: 'purpose',
      title: 'Assistant purpose',
      description: 'Choose whether this is for website customers or the internal help desk.',
      href: hasAssistant ? '/company/bots' : '/company/bots/new',
      complete: hasAssistant,
      detail: hasAssistant ? `${bots.length} assistant${bots.length === 1 ? '' : 's'} created` : 'Create the first assistant',
    },
    {
      key: 'capabilities',
      title: 'Capabilities',
      description: 'Select what the assistant can actually do: sales, booking, support, leads, orders, or help desk.',
      href: hasAssistant ? '/company/bots' : '/company/bots/new',
      complete: hasCapabilities,
      detail: hasCapabilities ? 'Capabilities selected' : 'Choose customer-facing or help desk capabilities',
    },
    {
      key: 'required-data',
      title: 'Required business data',
      description: 'Add only the facts needed for selected capabilities: basics, services, FAQs, policies, products, or files.',
      href: '/company/business-data',
      complete: hasRequiredData,
      detail: hasRequiredData
        ? `${businessDataCount} structured item${businessDataCount === 1 ? '' : 's'}, ${docs.length} document${docs.length === 1 ? '' : 's'}`
        : 'Add the missing business facts',
    },
    {
      key: 'test',
      title: 'Test assistant',
      description: 'Preview answers before launch and confirm it says “I do not know” when data is missing.',
      href: '/company/widget',
      complete: canTest,
      detail: canTest ? 'Ready to test in the widget preview' : 'Complete purpose, capabilities, and required data first',
    },
    {
      key: 'install',
      title: 'Install widget',
      description: 'Add allowed website domains, copy the script, and go live.',
      href: '/company/widget',
      complete: widgetInstalled,
      detail: widgetInstalled ? 'Website domain configured' : 'Add allowed domain and install snippet',
    },
  ];

  const complete = steps.filter((step) => step.complete).length;
  const total = steps.length;

  return {
    companyName: company.name,
    percent: Math.round((complete / total) * 100),
    complete,
    total,
    nextStep: steps.find((step) => !step.complete) ?? null,
    steps,
    stats: {
      bots: bots.length,
      knowledgeDocs: docs.length,
      teamMembers: members.length,
      businessReadiness: memory.readiness.percent,
    },
    customerReadiness,
  };
}
