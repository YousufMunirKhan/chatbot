/**
 * Integration provider layer (Module 14).
 *
 * A common interface for Shopify, WooCommerce, CSV, Custom API, and POS/CRM
 * connectors. Each provider syncs external business data into the STRUCTURED
 * tables of Module 15 (never only vector chunks). Credentials are encrypted at
 * rest (see `@/lib/crypto`). Hourly reconciliation + webhooks run via Trigger.dev.
 */
export type IntegrationProvider =
  | 'shopify'
  | 'woocommerce'
  | 'csv'
  | 'custom_api'
  | 'pos'
  | 'crm';

export type SyncJobType = 'products' | 'variants' | 'inventory' | 'orders' | 'customers' | 'full';

export interface SyncResult {
  recordsProcessed: number;
  errors: string[];
}

export interface IntegrationConnector {
  readonly provider: IntegrationProvider;
  testConnection(companyId: string): Promise<boolean>;
  sync(companyId: string, jobType: SyncJobType): Promise<SyncResult>;
}
