import { z } from 'zod';
import { RESOURCE_KINDS } from './game';

export const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_:-]+$/);
export const displayName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N} _-]+$/u)
  .refine((v) => !/(admin|moderator|support|운영자|관리자)/i.test(v), 'Reserved name');
const key = z.string().uuid();
export const claimSchema = z.object({ territory_id: id, idempotency_key: key }).strict();
export const sellSchema = z
  .object({
    kind: z.enum(RESOURCE_KINDS),
    quantity: z.number().int().min(1).max(10_000),
    price_gold: z.number().int().min(1).max(10_000),
    idempotency_key: key,
  })
  .strict();
export const keySchema = z.object({ idempotency_key: key }).strict();
export const loginSchema = z
  .object({
    display_name: displayName,
    region_id: id,
    territory_id: id.optional(),
    locale: z.enum(['en', 'ko']).default('en'),
    accept_rules: z.literal(true),
  })
  .strict();
export const profileSchema = z
  .object({
    display_name: displayName,
    locale: z.enum(['en', 'ko']),
    flag_style: z.enum(['fern', 'ocean', 'sunset']),
  })
  .strict();
export const reportSchema = z
  .object({
    target_type: z.enum(['territory', 'order']),
    target_id: id,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
