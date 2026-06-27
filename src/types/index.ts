/**
 * Shared application types. Tenant-scoped entities always carry `companyId`
 * to enforce data isolation (Developer Rule: "All data must be company-isolated").
 *
 * As each module is built, add its domain types here or in a co-located
 * `types.ts` and re-export from this barrel.
 */
import type {
  BotCapability,
  BotType,
  Channel,
  ContentType,
  ConversationStatus,
  Role,
} from '@/lib/constants';

export type ID = string;

export interface Company {
  id: ID;
  name: string;
  website: string | null;
  country: string | null;
  timezone: string | null;
  defaultLanguage: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface CompanyUser {
  id: ID;
  companyId: ID;
  userId: ID;
  role: Role;
  permissionsJson: Record<string, unknown>;
  createdAt: string;
}

export interface Bot {
  id: ID;
  companyId: ID;
  name: string;
  botType: BotType;
  systemPrompt: string | null;
  languageDefault: string;
  appearanceJson: Record<string, unknown>;
  capabilityFlags: BotCapability[];
  publicBotId: string;
  domainAllowlist: string[];
  aiEnabled: boolean;
  createdAt: string;
}

export interface Conversation {
  id: ID;
  companyId: ID;
  botId: ID;
  channel: Channel;
  status: ConversationStatus;
  aiEnabled: boolean;
  language: string;
  visitorId: string | null;
  customerId: string | null;
  assignedAgentId: ID | null;
  currentIntent: string | null;
  stateJson: Record<string, unknown>;
  startedAt: string;
  closedAt: string | null;
  expiresAt: string | null;
}

export interface Message {
  id: ID;
  companyId: ID;
  conversationId: ID;
  channel: Channel;
  senderType: 'visitor' | 'ai' | 'agent' | 'system';
  senderId: string | null;
  contentText: string;
  contentType: ContentType;
  language: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

/** Standard paginated API result shape. */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
