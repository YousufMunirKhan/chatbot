/**
 * English dictionary — the source of truth for every UI string that has a
 * translation.
 *
 * FLAT KEYS ON PURPOSE. A nested tree looks tidier but makes "does Arabic have
 * every key?" a recursive walk instead of `Object.keys(en)`, and makes the
 * TypeScript parity check below impossible. The dot is part of the key, not a
 * path.
 *
 * NAV KEYS ARE DERIVED FROM THE HREF (`navKey()` in ./index): `/company/inbox`
 * → `nav.company.inbox`. That is what lets the shell translate the navigation
 * without the nav arrays being restructured into label keys — a missing entry
 * falls back to the English label already in the array, so adding a route never
 * breaks the sidebar.
 *
 * `ar.ts` is typed as `Record<keyof typeof en, string>`, so a key added here
 * without an Arabic counterpart is a compile error, not a runtime hole. The
 * test script asserts the same thing at runtime.
 */
export const en = {
  // --- navigation: platform -------------------------------------------------
  'nav.group.platform': 'Platform',
  'nav.group.company': 'Company',
  'nav.group.workspace': 'Workspace',
  'nav.super-admin': 'Command Center',
  'nav.super-admin.companies': 'Companies',
  'nav.super-admin.agencies': 'Agencies',
  'nav.super-admin.billing': 'Billing & Plans',
  'nav.super-admin.quality': 'Quality & Usage',
  'nav.super-admin.subscriptions': 'Subscriptions',
  'nav.super-admin.usage': 'Usage',
  'nav.super-admin.costs': 'AI Cost',
  'nav.super-admin.profit': 'Profit / Loss',
  'nav.super-admin.chat-logs': 'Chat Logs',
  'nav.super-admin.integrations': 'Integrations',
  'nav.super-admin.notifications': 'Notifications',
  'nav.super-admin.audit-logs': 'Audit Logs',
  'nav.super-admin.security': 'Security Logs',
  'nav.super-admin.error-logs': 'Error Logs',
  'nav.super-admin.settings': 'Settings',

  // --- navigation: company --------------------------------------------------
  'nav.company': 'Home',
  'nav.company.setup': 'Get set up',
  'nav.company.bots': 'My assistants',
  'nav.company.widget': 'Website chat',
  'nav.company.help-desk': 'Staff help desk',
  'nav.company.inbox': 'Inbox',
  'nav.company.notifications': 'Alerts',
  'nav.company.customers': 'Customers',
  'nav.company.business-data': 'My business info',
  'nav.company.quick-actions': 'Chat buttons',
  'nav.company.groups': 'Groups',
  'nav.company.agency': 'Agency',
  'nav.company.webhooks': 'Webhooks',
  'nav.company.settings': 'All settings',

  // --- shell chrome ---------------------------------------------------------
  'shell.account': 'Account',
  'shell.viewing_customer': 'Viewing customer account',
  'shell.open_menu': 'Open menu',
  'shell.close_menu': 'Close menu',
  'shell.nav_menu': 'Navigation menu',
  'shell.nav_menu_description': 'Move between the sections of the dashboard.',
  'shell.role.super_admin': 'Super Admin',
  'shell.role.company_admin': 'Company Admin',
  'shell.role.agent': 'Agent',
  'shell.role.member': 'Member',
  'shell.role.impersonating': 'Impersonating {company}',
  'shell.sign_out': 'Sign out',

  // --- common buttons and words --------------------------------------------
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.create': 'Create',
  'common.search': 'Search',
  'common.export': 'Export',
  'common.active': 'Active',
  'common.paused': 'Paused',
  'common.edit': 'Edit',
  'common.rename': 'Rename',
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.clear': 'Clear',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.saving': 'Saving…',
  'common.none': 'None',

  // --- table headers --------------------------------------------------------
  'table.name': 'Name',
  'table.email': 'Email',
  'table.role': 'Role',
  'table.status': 'Status',
  'table.created': 'Created',
  'table.updated': 'Updated',
  'table.amount': 'Amount',
  'table.date': 'Date',
  'table.actions': 'Actions',
  'table.members': 'Members',
  'table.company': 'Company',

  // --- generic empty states -------------------------------------------------
  'empty.nothing_here': 'Nothing here yet',
  'empty.no_results': 'No results',
  'empty.no_results_body': 'Try a different search or clear the filters.',

  // --- form validation ------------------------------------------------------
  'validation.required': 'Required',
  'validation.invalid': 'Invalid value',
  'validation.too_short': 'Too short',
  'validation.too_long': 'Too long',
  'validation.invalid_email': 'Enter a valid email address',
  'validation.invalid_url': 'Enter a valid URL',
  'validation.invalid_colour': 'Enter a colour like #2563eb',
  'validation.min': 'Must be at least {min}',
  'validation.max': 'Must be {max} or less',

  // --- navigation: company section headings ---------------------------------
  // Keyed by the group's slug, not its English wording — see
  // src/components/dashboard-nav-items.ts.
  'nav.group.start': 'Start here',
  'nav.group.conversations': 'Talk to customers',
  'nav.group.assistant': 'Teach your assistant',
  'nav.group.reach': 'Where customers find you',
  'nav.group.sell': 'Sell more',
  'nav.group.results': "How it's going",
  'nav.group.account': 'Your account',

  // --- navigation: company (routes added since the first pass) --------------
  'nav.company.channels': 'Messaging apps',
  'nav.company.whatsapp': 'WhatsApp',
  'nav.company.flows': 'Guided chats',
  'nav.company.intents': 'Trigger phrases',
  'nav.company.quality': 'Improve answers',
  'nav.company.catalog': 'Products',
  'nav.company.automations': 'Automatic messages',
  'nav.company.broadcasts': 'Bulk messages',
  'nav.company.campaigns': 'Chat invites',
  'nav.company.reports': 'Reports',
  'nav.company.usage': 'Usage & limits',
  'nav.company.agents': 'Team',
  'nav.company.billing': 'Billing',

  // --- settings hub sub-headings -------------------------------------------
  'settings.group.people': 'People',
  'settings.group.money': 'Plan and spending',
  'settings.group.connected': 'Connected apps',
  'settings.group.service': 'Service and safety',
  'settings.section.webhooks.label': 'Send data elsewhere',
  'settings.section.webhooks.hint':
    'Push new leads and orders into Slack, a CRM, or your own system.',
  'settings.section.developers.label': 'For developers',
  'settings.section.developers.hint': 'API keys and code, if someone is building on top of this.',
  'settings.section.sla.label': 'Reply-time targets',
  'settings.section.sla.hint':
    'How fast your team promises to answer, and a warning before you miss it.',
  'settings.section.support-settings.label': 'Inbox rules',
  'settings.section.support-settings.hint': 'Opening hours and who a new chat goes to.',
  'settings.pending.empty_body':
    'When a customer asks for a copy of their data or asks you to delete it, the request waits here until you act on it.',

  // --- company home --------------------------------------------------------
  'home.setup.title': 'Set up your assistant',
  'home.setup.body':
    'It answers your customers on your website day and night, takes their details while you are busy, and passes anything it cannot answer straight to you.',
  'home.setup.cta': 'Set up my assistant',
  'home.feature.answers.title': 'It answers questions',
  'home.feature.answers.body':
    'Opening hours, prices, delivery, returns — in your own words, from what you tell it.',
  'home.feature.details.title': 'It takes details',
  'home.feature.details.body':
    'Names, numbers and what the customer wanted, ready for you to follow up.',
  'home.feature.handover.title': 'It hands over to you',
  'home.feature.handover.body':
    'Anything it cannot answer lands in your inbox with the whole conversation.',
  'home.step.progress': 'Step {current} of {total}',
  'home.cta.purpose': 'Choose what it does',
  'home.cta.capabilities': 'Pick the jobs',
  'home.cta.required-data': 'Add my details',
  'home.cta.test': 'Try it now',
  'home.cta.install': 'Get my website code',
  'home.live.title': 'Your assistant is live',
  'home.live.body':
    'Nobody has chatted this week. That is normal in the first few days — the chat only opens when someone on your website clicks it.',
  'home.live.ask': 'Ask it a question',
  'home.live.check': 'Check my website',
  'home.waiting.one': '1 person is waiting for you',
  'home.waiting.many': '{count} people are waiting for you',
  'home.waiting.body': 'Your assistant could not finish these on its own.',
  'home.waiting.cta': 'Open the inbox',
  'home.clear.title': 'Nothing is waiting for you',
  'home.clear.body': 'Your assistant has handled every chat so far.',
  'home.clear.link': 'Open the inbox',
  'home.attention.heading': 'Needs you now',
  'home.attention.overdue_replies.one': '1 chat is past your reply-time target',
  'home.attention.overdue_replies.many': '{count} chats are past your reply-time target',
  'home.attention.overdue_replies.body':
    'Nobody has replied to these and the time you promised has already run out.',
  'home.attention.overdue_replies.cta': 'Answer them now',
  'home.attention.needs_reply.one': '1 person is waiting for you in chat',
  'home.attention.needs_reply.many': '{count} people are waiting for you in chat',
  'home.attention.needs_reply.body': 'Your assistant could not finish these on its own.',
  'home.attention.needs_reply.cta': 'Open the inbox',
  'home.attention.uncontacted_enquiries.one': '1 enquiry nobody has contacted',
  'home.attention.uncontacted_enquiries.many': '{count} enquiries nobody has contacted',
  'home.attention.uncontacted_enquiries.body':
    'They left their details and are still waiting to hear back from you.',
  'home.attention.uncontacted_enquiries.cta': 'See the enquiries',
  'home.attention.failed_automations.one': '1 automatic message did not send',
  'home.attention.failed_automations.many': '{count} automatic messages did not send',
  'home.attention.failed_automations.body':
    'The customer never got them. Check the rule before it happens again.',
  'home.attention.failed_automations.cta': 'Check the messages',
  'home.week.title': 'The last 7 days',
  'home.signal.chats': 'Chats this week',
  'home.signal.chats.hint': 'People who opened the chat on your website or apps',
  'home.signal.answered': 'Answered on its own',
  'home.signal.answered.hint': 'Finished without ever needing a person',
  'home.signal.enquiries': 'New customer requests',
  'home.signal.enquiries.hint': 'Enquiries, booking requests and orders taken in chat',
  'home.signal.rating': 'Customer rating',
  'home.signal.rating.one': 'From 1 rating this week',
  'home.signal.rating.many': 'From {count} ratings this week',
  'home.csat.none': 'Nobody rated a chat this week.',
  'home.csat.off': 'Customers are not being asked to rate their chat.',
  'home.csat.off.link': 'Turn on the star rating',
  'home.finish.one': '1 thing left to set up',
  'home.finish.many': '{count} things left to set up',
  'home.finish.body': 'Your assistant is already live. These are the parts still missing.',
  'home.finish.link': 'See the whole checklist',
  'home.trend.same': 'Same as last week',
  'home.trend.change': '{direction}{value} vs last week',
  'home.unanswered.title': 'Questions it could not answer',
  'home.unanswered.body':
    'Customers asked these and your assistant had nothing to go on. Tell it the answer once and it will handle them from now on.',
  'home.unanswered.once': 'Asked once this week',
  'home.unanswered.times': 'Asked {count} times this week',
  'home.unanswered.cta': 'Answer this',

  // --- inbox ----------------------------------------------------------------
  'inbox.title': 'Inbox',
  'inbox.description': 'Every chat with your customers and your team.',
  'inbox.saved_replies': 'Saved replies',
  'inbox.queues.label': 'Conversation queues',
  'inbox.queue.waiting': 'Waiting for you',
  'inbox.queue.mine': 'Assigned to me',
  'inbox.queue.everything': 'Everything',
  'inbox.queue.urgent': 'Urgent',
  'inbox.queue.poor': 'Rated poorly',
  'inbox.queue.closed': 'Closed',
  'inbox.search.label': 'Search conversations',
  'inbox.search.placeholder': 'Search names, numbers, or what was said…',
  'inbox.chip.overdue': 'Overdue',
  'inbox.chip.waiting': 'Waiting for you',
  'inbox.chip.urgent': 'Urgent',
  'inbox.chip.rated': 'Rated {rating}/5',
  'inbox.chip.connector': 'Connector problem',
  'inbox.chip.human': 'A person is on it',
  'inbox.chip.closed': 'Sorted',
  'inbox.chip.expired': 'Went quiet',
  'inbox.preview.you': 'You: ',
  'inbox.preview.assistant': 'Assistant: ',
  'inbox.preview.none': 'No messages yet',
  'inbox.assigned': 'Assigned to {name}',
  'inbox.empty.search.title': 'Nothing matches “{query}”',
  'inbox.empty.search.body': 'Try a name, a phone number, or a word the customer used.',
  'inbox.empty.search.cta': 'Clear the search',
  'inbox.empty.none.title': 'No chats yet',
  'inbox.empty.none.body':
    'Once your assistant is on your website, every chat with a customer lands here.',
  'inbox.empty.none.cta': 'Put it on my website',
  'inbox.empty.waiting.title': 'Nothing is waiting for you',
  'inbox.empty.waiting.body': 'Your assistant is handling everything at the moment.',
  'inbox.empty.queue.title': 'Nothing in {queue}',
  'inbox.empty.queue.body': 'There are {count} chats in total.',
  'inbox.empty.see_all': 'See every chat',

  // --- team & settings ------------------------------------------------------
  'settings.title': 'Settings',
  'settings.description':
    'Your team, your bill, the apps you have connected, and how your data is kept.',
  'settings.section.agents.label': 'Team',
  'settings.section.agents.hint': 'Invite staff and see who is available to take chats.',
  'settings.section.billing.label': 'Billing',
  'settings.section.billing.hint': 'Your plan, your monthly message allowance, and your card.',
  'settings.section.integrations.label': 'Connect your shop',
  'settings.section.integrations.hint': 'Shopify, WooCommerce, Google Calendar, or a spreadsheet.',
  'settings.section.quick-actions.label': 'Quick actions',
  'settings.section.quick-actions.hint': 'Chat buttons and handoff shortcuts.',
  'settings.section.ai-controls.label': 'Spending cap',
  'settings.section.ai-controls.hint':
    'Stop the assistant automatically if it costs more than you want.',
  'settings.section.quality.label': 'Quality',
  'settings.section.quality.hint': 'Feedback and answer evaluation.',
  'settings.section.usage.label': 'Usage & limits',
  'settings.section.usage.hint': 'How much of this month’s allowance you have used.',
  'settings.section.security.label': 'Sign-in & security',
  'settings.section.security.hint': 'Two-step sign-in, and recent activity on your account.',
  'settings.section.channels.label': 'Channels',
  'settings.section.channels.hint': 'WhatsApp, Instagram, email, and SMS.',
  'settings.section.broadcasts.label': 'Broadcasts',
  'settings.section.broadcasts.hint': 'Send a message to a group of customers.',
  'settings.section.campaigns.label': 'Campaigns',
  'settings.section.campaigns.hint': 'Proactive messages triggered by visitor behaviour.',
  'settings.section.managed-connectors.label': 'Set up for you',
  'settings.section.managed-connectors.hint':
    'Shopify, Square and Foodics — paste a token, we do the rest.',
  'settings.section.catalog.label': 'Catalog',
  'settings.section.catalog.hint': 'Products and menu items the assistant can quote.',
  'settings.section.groups.label': 'Groups',
  'settings.section.groups.hint':
    'Name a set of staff, or a set of customers, so you can target it.',
  'settings.retention.title': 'Data retention',
  'settings.retention.description': 'Chats older than this are automatically deleted.',
  'settings.requests.title': 'Data requests',
  'settings.requests.description': 'Create export/delete requests for privacy operations.',
  'settings.pending.title': 'Pending data requests',
  'settings.pending.description':
    'Execute a deletion to permanently erase a person’s leads, appointments, and linked chats — or reject it. Every erasure is logged.',
  'settings.pending.empty': 'No pending requests.',
  'settings.pending.requested': 'Requested {date}',
  'settings.pending.erase': 'Erase data',
  'settings.pending.erase_confirm': 'Erase permanently',
  'settings.pending.erase_pending': 'Erasing…',
  'settings.pending.erase_question':
    'Permanently deletes this person’s conversations, leads and appointments.',
  'settings.pending.done': 'Mark done',
  'settings.pending.reject': 'Reject',
  'settings.export.title': 'Your data',
  'settings.export.description': 'Download a JSON bundle of your company’s records.',
  'settings.export.cta': 'Export my data',
  'settings.security.title': 'Security',
  'settings.security.description': 'Protections enforced on your account.',
  'settings.security.point.encryption': 'Integration tokens are encrypted at rest.',
  'settings.security.point.isolation':
    'Company data isolation enforced via row-level security (RLS).',
  'settings.security.point.ratelimit': 'Rate limiting protects against abuse.',
  'settings.security.point.orders':
    'Order verification is required before sensitive order actions.',
  'settings.security.point.cards': 'No card or payment details are ever collected in chat.',

  // --- groups ---------------------------------------------------------------
  'groups.title': 'Groups',
  'groups.description':
    'Named sets of teammates and of contacts, so broadcasts and routing can target a group instead of a list.',
  'groups.tab.team': 'Team groups',
  'groups.tab.contacts': 'Contact groups',
  'groups.empty.team': 'No team groups yet',
  'groups.empty.contacts': 'No contact groups yet',

  // --- billing / auto top-up ------------------------------------------------
  'billing.autotopup.title': 'Automatic top-up',
  'billing.autotopup.description':
    'Charge your saved card automatically when your AI credit runs low.',
} as const;

/** Every translatable key. `ar.ts` must supply all of them. */
export type TranslationKey = keyof typeof en;

export type Dictionary = Record<TranslationKey, string>;
