import type { AssistantTool } from './types';
import { runHelpdeskConnectorAction } from '@/lib/helpdesk/runtime';

export const runHelpdeskAction: AssistantTool = {
  audiences: ['internal'],
  capabilities: [
    'help_desk',
    'internal_process_guide',
    'internal_products_read',
    'internal_stock_read',
    'internal_stock_update',
    'internal_orders_read',
    'internal_customers_read',
    'internal_leads_read',
  ],
  schema: {
    name: 'run_helpdesk_action',
    description:
      'Run an approved Help Desk connector action inside the customer system, such as business-specific searches, reports, or safe updates. Use only action names listed in the prompt.',
    parameters: {
      type: 'object',
      properties: {
        action_name: {
          type: 'string',
          description: 'Approved connector action name, for example search_product or daily_sales_report.',
        },
        connector_id: {
          type: 'string',
          description: 'Optional connector id when multiple systems expose the same action.',
        },
        input: {
          type: 'object',
          description: 'Action input object using the required fields from the connector manifest.',
          additionalProperties: true,
        },
        confirmed: {
          type: 'boolean',
          description:
            'True only after the user explicitly confirms a create/update/high-risk action. Keep false for read/report actions.',
        },
      },
      required: ['action_name', 'input'],
    },
  },
  async execute(input, ctx) {
    return runHelpdeskConnectorAction(input, ctx);
  },
};

export const helpdeskTools = [runHelpdeskAction];
