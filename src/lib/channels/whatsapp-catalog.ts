/**
 * WhatsApp catalog selling (Meta commerce).
 *
 * Once a company connects a Meta commerce catalog, the assistant can send
 * native product cards instead of a text price list — the customer taps
 * through to a cart inside WhatsApp, which is the difference between an
 * enquiry and an order.
 *
 * Products are addressed by `product_retailer_id`, the id in the commerce
 * catalog feed. That is stored on `synced_products.whatsapp_retailer_id`
 * because it need not equal the store SKU.
 *
 * The builders are pure so their exact JSON is testable without credentials.
 */

import { sendWhatsAppRaw } from './adapters/whatsapp';

export interface CatalogSection {
  title: string;
  retailerIds: string[];
}

/** Single product card: `interactive.type = 'product'`. */
export function buildProductMessage(
  catalogId: string,
  productRetailerId: string,
  opts: { body?: string; footer?: string } = {},
): Record<string, unknown> {
  const interactive: Record<string, unknown> = {
    type: 'product',
    action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
  };
  if (opts.body) interactive.body = { text: opts.body.slice(0, 1024) };
  if (opts.footer) interactive.footer = { text: opts.footer.slice(0, 60) };
  return { type: 'interactive', interactive };
}

/**
 * Multi-product list: `interactive.type = 'product_list'`.
 *
 * WhatsApp caps this at 30 items across 10 sections and requires a text
 * header plus a body, so we clamp here rather than let Meta reject the send.
 */
export function buildProductListMessage(
  catalogId: string,
  sections: CatalogSection[],
  opts: { header?: string; body?: string; footer?: string } = {},
): Record<string, unknown> {
  let remaining = 30;
  const usable: Record<string, unknown>[] = [];
  for (const section of sections.slice(0, 10)) {
    const items = section.retailerIds.filter(Boolean).slice(0, remaining);
    if (!items.length) continue;
    remaining -= items.length;
    usable.push({
      title: section.title.slice(0, 24),
      product_items: items.map((id) => ({ product_retailer_id: id })),
    });
    if (remaining <= 0) break;
  }

  const interactive: Record<string, unknown> = {
    type: 'product_list',
    header: { type: 'text', text: (opts.header ?? 'Our products').slice(0, 60) },
    body: { text: (opts.body ?? 'Tap a product to see the details.').slice(0, 1024) },
    action: { catalog_id: catalogId, sections: usable },
  };
  if (opts.footer) interactive.footer = { text: opts.footer.slice(0, 60) };

  return { type: 'interactive', interactive };
}

/** Send one product card. */
export async function sendWhatsAppProduct(
  token: string,
  phoneNumberId: string,
  to: string,
  catalogId: string,
  productRetailerId: string,
  opts: { body?: string; footer?: string } = {},
): Promise<boolean> {
  if (!catalogId || !productRetailerId) return false;
  return sendWhatsAppRaw(token, phoneNumberId, to, buildProductMessage(catalogId, productRetailerId, opts));
}

/** Send a multi-product list. Returns false when nothing sendable was supplied. */
export async function sendWhatsAppProductList(
  token: string,
  phoneNumberId: string,
  to: string,
  catalogId: string,
  sections: CatalogSection[],
  opts: { header?: string; body?: string; footer?: string } = {},
): Promise<boolean> {
  if (!catalogId) return false;
  const message = buildProductListMessage(catalogId, sections, opts);
  const action = (message.interactive as { action: { sections: unknown[] } }).action;
  if (action.sections.length === 0) return false;
  return sendWhatsAppRaw(token, phoneNumberId, to, message);
}
