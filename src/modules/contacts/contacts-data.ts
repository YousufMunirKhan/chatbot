import { createSupabaseServiceClient } from '@/lib/db/server';
import { humanizeStoredSubmission } from '@/lib/quick-actions-format';
import { getCompanyId } from '@/modules/company/data';
import { contactDisplayName } from './identity';

/**
 * Contacts — the read side of the person record (migration 0076).
 *
 * Every query is bound to the SESSION user's own `companyId`, never a value out
 * of the request. The service-role client bypasses RLS, so that filter IS the
 * tenant boundary, and identity resolution deliberately never crosses it: two
 * companies may both know jane@example.com and they are two different people.
 *
 * ROUND TRIPS
 * The app server and its Postgres are in different places and one round trip
 * costs ~229 ms regardless of what it asks for, so the count is what matters,
 * not the query shape. The list page therefore spends exactly two: one RPC that
 * returns all five totals, and one page of rows that carries its own exact
 * count. It is cheaper than the tab page it replaces, which spent four head
 * counts plus a page of rows.
 */

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface ContactListRow {
  id: string;
  /** Already resolved to something showable — never blank. */
  name: string;
  emails: string[];
  phones: string[];
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ContactCounts {
  people: number;
  enquiries: number;
  bookings: number;
  orders: number;
  /**
   * Enquiries that left no email and no phone, so no person could be built from
   * them. They are still real work; the page links to them rather than pretending
   * the business has fewer customers than it does.
   */
  unidentifiedEnquiries: number;
}

export interface ContactListPage {
  rows: ContactListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ListContactsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

const CONTACT_COLUMNS = 'id,display_name,emails,phones,tags,first_seen_at,last_seen_at';

function toListRow(row: Record<string, unknown>): ContactListRow {
  const emails = (row.emails as string[]) ?? [];
  const phones = (row.phones as string[]) ?? [];
  return {
    id: row.id as string,
    name: contactDisplayName({
      displayName: (row.display_name as string) ?? null,
      emails,
      phones,
    }),
    emails,
    phones,
    tags: (row.tags as string[]) ?? [],
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
  };
}

/**
 * One page of people, newest contact first.
 *
 * The search runs against `contacts.searchable` — name and every address, one
 * lowercased column maintained by a trigger — rather than an `or` across three
 * columns and two arrays, which PostgREST can express but Postgres cannot index.
 */
export async function listContacts(opts: ListContactsOptions = {}): Promise<ContactListPage> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from('contacts')
    .select(CONTACT_COLUMNS, { count: 'exact' })
    .eq('company_id', companyId);

  const search = opts.search?.trim();
  if (search) {
    // `%` and `,` are PostgREST filter syntax, not text, and a stray one either
    // matches everything or splits the filter in half.
    const safe = search.replace(/[%,()]/g, ' ').toLowerCase();
    query = query.ilike('searchable', `%${safe}%`);
  }

  const { data, error, count } = await query
    .order('last_seen_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const total = count ?? 0;
  return {
    rows: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toListRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** All five totals in one round trip — see `company_contact_counts` in 0076. */
export async function getContactCounts(): Promise<ContactCounts> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .rpc('company_contact_counts', { p_company_id: companyId })
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    people: Number(row.people ?? 0),
    enquiries: Number(row.enquiries ?? 0),
    bookings: Number(row.bookings ?? 0),
    orders: Number(row.orders ?? 0),
    unidentifiedEnquiries: Number(row.unidentified_enquiries ?? 0),
  };
}

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

export interface ContactAttribute {
  key: string;
  value: string;
}

export interface ContactTimelineEntry {
  id: string;
  at: string;
  /** 'web_chat' | 'whatsapp' | 'email' | … — whichever channel carried it. */
  channel: string;
  conversationId: string;
  sender: 'visitor' | 'ai' | 'agent' | 'system';
  text: string;
}

export interface ContactConversation {
  id: string;
  channel: string;
  status: string;
  startedAt: string;
  lastMessageAt: string;
}

export interface ContactEnquiry {
  id: string;
  enquiryType: string | null;
  message: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  conversationId: string | null;
}

export interface ContactBooking {
  id: string;
  serviceType: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  status: string;
  createdAt: string;
}

export interface ContactOrder {
  id: string;
  reference: string | null;
  status: string | null;
  total: number;
  currency: string;
  createdAt: string;
  /** 'chat' when placed in conversation, 'store' when synced from Shopify/Woo. */
  origin: 'chat' | 'store';
}

export interface ContactNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface ContactDetail {
  id: string;
  /** Never blank — falls back to the first address. */
  name: string;
  /** The stored name, which may well be null. The edit form needs the raw value. */
  displayName: string | null;
  emails: string[];
  phones: string[];
  tags: string[];
  attributes: ContactAttribute[];
  firstSeenAt: string;
  lastSeenAt: string;
  timeline: ContactTimelineEntry[];
  /** True when the person has said more than the timeline is showing. */
  timelineTruncated: boolean;
  conversations: ContactConversation[];
  enquiries: ContactEnquiry[];
  bookings: ContactBooking[];
  orders: ContactOrder[];
  notes: ContactNote[];
}

/**
 * How far back the timeline goes.
 *
 * A person who has been chatting for two years is not helped by two years of
 * bubbles on one page, and the request has to come back. The newest slice is
 * the useful one; the conversations list underneath links to the rest in the
 * inbox, where paging already exists.
 */
const TIMELINE_MESSAGE_LIMIT = 200;
const TIMELINE_CONVERSATION_LIMIT = 50;
const RELATED_ROW_LIMIT = 50;

const SENDERS: ReadonlyArray<ContactTimelineEntry['sender']> = ['visitor', 'ai', 'agent', 'system'];

function toSender(value: unknown): ContactTimelineEntry['sender'] {
  const sender = String(value ?? '');
  return (SENDERS as readonly string[]).includes(sender)
    ? (sender as ContactTimelineEntry['sender'])
    : 'system';
}

/** jsonb comes back as an object; the page wants a stable, sorted list. */
function toAttributes(value: unknown): ContactAttribute[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => ({
      key,
      value: typeof raw === 'string' ? raw : JSON.stringify(raw),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Everything about one person.
 *
 * Two waves. The first asks for the contact and every event attached to it at
 * once; the second needs the conversation ids from the first before it can ask
 * for messages, and resolves the note authors' names at the same time. Returns
 * null when the id belongs to another company — the caller renders `notFound()`,
 * so a guessed id is indistinguishable from a deleted one.
 */
export async function getContactDetail(contactId: string): Promise<ContactDetail | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [contactRes, leadRes, conversationRes, appointmentRes, chatOrderRes, storeOrderRes, noteRes] =
    await Promise.all([
      sb
        .from('contacts')
        .select('id,display_name,emails,phones,tags,attributes_json,first_seen_at,last_seen_at')
        .eq('company_id', companyId)
        .eq('id', contactId)
        .maybeSingle(),
      sb
        .from('leads')
        .select('id,enquiry_type,message,status,source,created_at,conversation_id')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(RELATED_ROW_LIMIT),
      sb
        .from('conversations')
        .select('id,channel,status,started_at,last_message_at')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(TIMELINE_CONVERSATION_LIMIT),
      sb
        .from('appointments')
        .select('id,service_type,preferred_date,preferred_time,status,created_at')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(RELATED_ROW_LIMIT),
      sb
        .from('chat_orders')
        .select('id,status,total,currency,created_at,external_ref')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(RELATED_ROW_LIMIT),
      sb
        .from('synced_orders')
        .select('id,status,total,currency,created_at,placed_at,order_number')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(RELATED_ROW_LIMIT),
      sb
        .from('contact_notes')
        .select('id,body,author_id,created_at')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(RELATED_ROW_LIMIT),
    ]);

  const contactRow = contactRes.data as Record<string, unknown> | null;
  if (!contactRow) return null;

  const conversationRows = (conversationRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const noteRows = (noteRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const conversationIds = conversationRows.map((row) => row.id as string);
  const authorIds = [
    ...new Set(noteRows.map((row) => row.author_id as string | null).filter(Boolean)),
  ] as string[];

  const [messageRes, authorRes] = await Promise.all([
    conversationIds.length
      ? sb
          .from('messages')
          .select('id,conversation_id,channel,sender_type,content_text,created_at')
          .eq('company_id', companyId)
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false })
          .limit(TIMELINE_MESSAGE_LIMIT + 1)
      : Promise.resolve({ data: [] as unknown[] }),
    // `users` is not company-scoped on purpose: the ids came off rows that were
    // already company-scoped, and an author may since have left the company.
    authorIds.length
      ? sb.from('users').select('id,full_name,email').in('id', authorIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const channelByConversation = new Map(
    conversationRows.map((row) => [row.id as string, (row.channel as string) ?? 'web_chat']),
  );
  const authorNames = new Map(
    ((authorRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => [
      row.id as string,
      ((row.full_name as string) || (row.email as string) || 'A colleague') as string,
    ]),
  );

  const messageRows = (messageRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const timelineTruncated = messageRows.length > TIMELINE_MESSAGE_LIMIT;
  const timeline: ContactTimelineEntry[] = messageRows
    .slice(0, TIMELINE_MESSAGE_LIMIT)
    .map((row) => {
      const conversationId = row.conversation_id as string;
      return {
        id: row.id as string,
        at: row.created_at as string,
        // A message carries its own channel, but a row written before the
        // channel columns existed does not; the conversation always knows.
        channel:
          (row.channel as string) || channelByConversation.get(conversationId) || 'web_chat',
        conversationId,
        sender: toSender(row.sender_type),
        // Pre-chat details and quick-action submissions are stored as a JSON
        // blob by older writers. Render them as the sentences they mean.
        text: humanizeStoredSubmission((row.content_text as string) ?? ''),
      };
    });

  const chatOrders: ContactOrder[] = (
    (chatOrderRes.data ?? []) as unknown as Array<Record<string, unknown>>
  ).map((row) => ({
    id: row.id as string,
    reference: (row.external_ref as string) ?? null,
    status: (row.status as string) ?? null,
    total: Number(row.total ?? 0),
    currency: (row.currency as string) || 'GBP',
    createdAt: row.created_at as string,
    origin: 'chat' as const,
  }));

  const storeOrders: ContactOrder[] = (
    (storeOrderRes.data ?? []) as unknown as Array<Record<string, unknown>>
  ).map((row) => ({
    id: row.id as string,
    reference: (row.order_number as string) ?? null,
    status: (row.status as string) ?? null,
    total: Number(row.total ?? 0),
    currency: (row.currency as string) || 'GBP',
    createdAt: ((row.placed_at as string) || (row.created_at as string)) as string,
    origin: 'store' as const,
  }));

  const emails = (contactRow.emails as string[]) ?? [];
  const phones = (contactRow.phones as string[]) ?? [];

  return {
    id: contactRow.id as string,
    name: contactDisplayName({
      displayName: (contactRow.display_name as string) ?? null,
      emails,
      phones,
    }),
    displayName: (contactRow.display_name as string) ?? null,
    emails,
    phones,
    tags: (contactRow.tags as string[]) ?? [],
    attributes: toAttributes(contactRow.attributes_json),
    firstSeenAt: contactRow.first_seen_at as string,
    lastSeenAt: contactRow.last_seen_at as string,
    timeline,
    timelineTruncated,
    conversations: conversationRows.map((row) => ({
      id: row.id as string,
      channel: (row.channel as string) ?? 'web_chat',
      status: (row.status as string) ?? 'ai_active',
      startedAt: row.started_at as string,
      lastMessageAt: row.last_message_at as string,
    })),
    enquiries: ((leadRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      enquiryType: (row.enquiry_type as string) ?? null,
      message: (row.message as string) ?? null,
      status: (row.status as string) ?? 'new',
      source: (row.source as string) ?? null,
      createdAt: row.created_at as string,
      conversationId: (row.conversation_id as string) ?? null,
    })),
    bookings: ((appointmentRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(
      (row) => ({
        id: row.id as string,
        serviceType: (row.service_type as string) ?? null,
        preferredDate: (row.preferred_date as string) ?? null,
        preferredTime: (row.preferred_time as string) ?? null,
        status: (row.status as string) ?? 'requested',
        createdAt: row.created_at as string,
      }),
    ),
    orders: [...chatOrders, ...storeOrders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    notes: noteRows.map((row) => ({
      id: row.id as string,
      body: (row.body as string) ?? '',
      authorName: authorNames.get((row.author_id as string) ?? '') ?? 'A colleague',
      createdAt: row.created_at as string,
    })),
  };
}
