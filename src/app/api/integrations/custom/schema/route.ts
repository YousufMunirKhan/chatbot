import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    auth: {
      type: 'Bearer token',
      header: 'Authorization: Bearer YOUR_TOKEN',
    },
    paths: {
      products_path: '/products',
      inventory_path: '/inventory',
      orders_path: '/orders',
      customers_path: '/customers',
    },
    products: [
      {
        id: 'prod_100',
        title: 'Retail EPOS',
        description: 'Cloud POS package for retail shops.',
        category: 'POS',
        price: 499,
        currency: 'GBP',
        sku: 'EPOS-RETAIL',
        status: 'active',
      },
    ],
    inventory: [
      {
        product_id: 'prod_100',
        sku: 'EPOS-RETAIL',
        quantity: 12,
        location: 'Main warehouse',
      },
    ],
    customers: [
      {
        id: 'cust_100',
        name: 'Aisha Khan',
        email: 'aisha@example.com',
        phone: '+441234567890',
      },
    ],
    orders: [
      {
        id: 'ord_100',
        order_number: '1001',
        customer_name: 'Aisha Khan',
        customer_email: 'aisha@example.com',
        customer_phone: '+441234567890',
        status: 'paid',
        fulfillment_status: 'processing',
        tracking_number: 'TRACK123',
        tracking_url: 'https://carrier.example/track/TRACK123',
        total: 499,
        currency: 'GBP',
        placed_at: '2026-06-26T12:00:00Z',
        items: [
          {
            title: 'Retail EPOS',
            quantity: 1,
            price: 499,
            sku: 'EPOS-RETAIL',
          },
        ],
      },
    ],
  });
}
