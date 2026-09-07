import {
  getContactCounts,
  listContacts,
  type ContactCounts,
  type ContactListPage,
} from '@/modules/contacts/contacts-data';

/**
 * The Customers page's data, in one call.
 *
 * WHAT THIS PAGE USED TO BE
 * Three previews stacked — leads, appointments, orders — each a row out of a
 * different table. It was rebuilt for performance once already: the counts
 * became head-only so "Enquiries 412" cost no rows, and only the tab actually
 * on screen fetched any. That rebuild is kept here, and improved on: the four
 * head counts are now one RPC (`company_contact_counts`, migration 0076), so
 * the page spends two round trips in total rather than five.
 *
 * WHAT IT IS NOW
 * A list of PEOPLE. The three tabs were three kinds of event, and the same
 * human appeared in all three as three unrelated strangers — which is exactly
 * the thing `contacts` exists to fix. The events are still one click away, and
 * the counts on those links are the real totals.
 *
 * The two queries are deliberately started together: they do not depend on each
 * other, and the app server and its Postgres are far enough apart that running
 * them in sequence would double the page's latency for no reason.
 */

export interface CustomersPageData {
  counts: ContactCounts;
  people: ContactListPage;
}

export interface CustomersPageOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

export async function getCustomersPage(
  opts: CustomersPageOptions = {},
): Promise<CustomersPageData> {
  const [counts, people] = await Promise.all([getContactCounts(), listContacts(opts)]);
  return { counts, people };
}

/**
 * Where the event lists live, for the row of links under the search box. They
 * are pages this module does not own and does not read — only names and points
 * at — so the labels sit here rather than being spelled out in the JSX three
 * times.
 */
export const CUSTOMER_RECORD_LINKS: ReadonlyArray<{
  key: keyof Pick<ContactCounts, 'enquiries' | 'bookings' | 'orders'>;
  label: string;
  href: string;
}> = [
  { key: 'enquiries', label: 'Enquiries', href: '/company/leads' },
  { key: 'bookings', label: 'Booking requests', href: '/company/appointments' },
  { key: 'orders', label: 'Orders', href: '/company/orders' },
];
