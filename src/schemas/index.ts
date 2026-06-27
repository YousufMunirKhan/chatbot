import { z } from 'zod';
import { BOT_CAPABILITIES, BOT_TYPES, SUPPORTED_LANGUAGES } from '@/lib/constants';

/**
 * Shared Zod validation schemas (Developer Rule: validate every input).
 * Co-locate module-specific schemas in the module folder and re-export here
 * if they are widely reused.
 */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createCompanySchema = z.object({
  name: z.string().min(2).max(120),
  website: z.string().url().optional(),
  country: z.string().length(2).optional(),
  timezone: z.string().optional(),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default('auto'),
});

export const createBotSchema = z.object({
  name: z.string().min(2).max(80),
  botType: z.enum(BOT_TYPES).default('hybrid_business_assistant'),
  languageDefault: z.enum(SUPPORTED_LANGUAGES).default('auto'),
  capabilityFlags: z.array(z.enum(BOT_CAPABILITIES)).default([]),
  domainAllowlist: z.array(z.string()).default([]),
});

export const leadSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(3).optional(),
  enquiryType: z.string().optional(),
  message: z.string().optional(),
});

export const incomingMessageSchema = z.object({
  publicBotId: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  text: z.string().min(1).max(4000),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type CreateBotInput = z.infer<typeof createBotSchema>;
export type LeadInput = z.infer<typeof leadSchema>;
export type IncomingMessageInput = z.infer<typeof incomingMessageSchema>;
