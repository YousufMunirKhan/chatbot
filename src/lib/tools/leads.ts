import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { checkAppointmentSlotBusy } from '@/lib/integrations/google-calendar';
import type { AssistantTool } from './types';
import { str } from './types';

/** Lead capture (Module 12) + appointment request (Module 13) tools. */
export const captureLead: AssistantTool = {
  capabilities: ['lead_capture', 'sales_agent'],
  schema: {
    name: 'capture_lead',
    description:
      'Save a sales/support lead once you have the visitor name and at least one contact (email or phone).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        enquiry_type: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async execute(input, ctx) {
    const email = str(input, 'email');
    const phone = str(input, 'phone');
    if (!email && !phone) {
      return { saved: false, error: 'Collect an email or phone number before saving the lead.' };
    }
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from('leads')
      .insert({
        company_id: ctx.companyId,
        bot_id: ctx.botId,
        conversation_id: ctx.conversationId,
        name: str(input, 'name'),
        email: email || null,
        phone: phone || null,
        enquiry_type: str(input, 'enquiry_type') || null,
        message: str(input, 'message') || null,
        source: 'chat',
      })
      .select('id')
      .single();
    if (error) return { saved: false };
    await notify({
      companyId: ctx.companyId,
      type: 'new_lead',
      title: 'New lead captured',
      body: `${str(input, 'name')} — ${email || phone}`,
      email: true,
    });
    return { saved: true, lead_id: data?.id };
  },
};

export const requestAppointment: AssistantTool = {
  capabilities: ['appointment_booking'],
  schema: {
    name: 'request_appointment',
    description:
      'Create an appointment request once you have the customer name, a contact, the service, and a preferred date/time.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        customer_email: { type: 'string' },
        service_type: { type: 'string' },
        preferred_date: { type: 'string', description: 'YYYY-MM-DD' },
        preferred_time: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['customer_name', 'service_type'],
    },
  },
  async execute(input, ctx) {
    const phone = str(input, 'customer_phone');
    const email = str(input, 'customer_email');
    const preferredDate = str(input, 'preferred_date');
    const preferredTime = str(input, 'preferred_time');
    if (!phone && !email) {
      return { saved: false, error: 'Collect a phone number or email before creating an appointment request.' };
    }
    if (!preferredDate || !preferredTime) {
      return { saved: false, error: 'Collect both preferred date and preferred time before creating an appointment request.' };
    }

    // If a calendar is connected, don't confirm an already-taken slot (Issue #11).
    const slot = await checkAppointmentSlotBusy({
      companyId: ctx.companyId,
      preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? preferredDate : null,
      preferredTime,
    });
    if (slot.connected && slot.busy) {
      return {
        saved: false,
        slot_unavailable: true,
        error: 'That time is already booked. Offer the customer a different date or time.',
      };
    }

    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from('appointments')
      .insert({
        company_id: ctx.companyId,
        bot_id: ctx.botId,
        conversation_id: ctx.conversationId,
        customer_name: str(input, 'customer_name'),
        customer_phone: phone || null,
        customer_email: email || null,
        service_type: str(input, 'service_type') || null,
        preferred_date: /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? preferredDate : null,
        preferred_time: preferredTime || null,
        notes: str(input, 'notes') || null,
        status: 'requested',
      })
      .select('id')
      .single();
    if (error) return { saved: false };
    await notify({
      companyId: ctx.companyId,
      type: 'new_appointment',
      title: 'New appointment request',
      body: `${str(input, 'customer_name')} — ${str(input, 'service_type')}`,
      email: true,
    });
    return { saved: true, appointment_id: data?.id };
  },
};

export const leadTools = [captureLead, requestAppointment];
