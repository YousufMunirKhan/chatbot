import { createSupabaseServiceClient } from '@/lib/db/server';

const TICKET_COUNTER_KEY = 'ticket_number_next';
const FIRST_TICKET_NUMBER = 1001;

export async function allocateTicketNumber(companyId: string): Promise<string> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_settings')
    .select('value_json')
    .eq('company_id', companyId)
    .eq('key', TICKET_COUNTER_KEY)
    .maybeSingle();

  const next = Math.max(FIRST_TICKET_NUMBER, Number(data?.value_json ?? FIRST_TICKET_NUMBER) || FIRST_TICKET_NUMBER);
  await sb.from('company_settings').upsert(
    { company_id: companyId, key: TICKET_COUNTER_KEY, value_json: next + 1 },
    { onConflict: 'company_id,key' },
  );

  return `HD-${next}`;
}

export function ticketNumberFromState(state: Record<string, unknown>, id: string): string {
  const ticketNumber = state.ticketNumber;
  if (typeof ticketNumber === 'string' && ticketNumber.trim()) return ticketNumber;
  return `HD-${id.slice(0, 6).toUpperCase()}`;
}
