import { z } from 'zod';

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'Legal'] as const;

export const orderItemInput = z.object({
  file_id: z.string().uuid().nullable().optional(),
  service: z.enum(['print', 'photocopy', 'scan', 'bind', 'laminate']),
  paper_size: z.enum(PAPER_SIZES).nullable().optional(),
  color: z.enum(['bw', 'color']).nullable().optional(),
  sides: z.enum(['single', 'duplex']).nullable().optional(),
  paper_gsm: z.number().int().min(40).max(300).nullable().optional(),
  option: z.string().max(40).nullable().optional(),
  copies: z.number().int().min(1).max(99),
  pages: z.number().int().min(1).max(2000),
});
export type OrderItemInput = z.infer<typeof orderItemInput>;

export const itemsReplaceInput = z.object({ items: z.array(orderItemInput).max(40) });

export const createOrderInput = z.object({ shop_slug: z.string().min(1).max(80) });

export const checkoutContact = z.object({
  customer_name: z.string().min(1).max(80),
  customer_phone: z.string().min(8).max(16),
  customer_email: z.string().email().max(120).or(z.literal('')).optional(),
  notes: z.string().max(500).optional(),
  rush: z.boolean().optional(),
});

export const paymentSubmittedInput = z.object({ utr: z.string().max(40).optional() });

export const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const disputeInput = z.object({
  order_id: z.string().uuid(),
  type: z.enum(['quality', 'missing_pages', 'overcharge', 'other']),
  description: z.string().min(5).max(1000),
});

export const signedUploadRequest = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(3).max(100),
  size: z.number().int().positive().max(25 * 1024 * 1024),
});

export const dropboxImportInput = z.object({
  links: z.array(z.string().url().max(2000)).min(1).max(10),
});

export const shopSignupInput = z.object({
  shop_name: z.string().min(2).max(80),
  owner_name: z.string().min(2).max(80),
  email: z.string().email().max(120),
  password: z.string().min(8).max(100),
  phone: z.string().min(8).max(16),
  address: z.string().min(3).max(200),
  city: z.string().min(2).max(80),
  gstin: z.string().max(20).optional(),
  upi_id: z.string().max(80).optional(),
});

export const settingsInput = z.object({
  name: z.string().min(2).max(80).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  phone: z.string().max(16).optional(),
  gstin: z.string().max(20).nullable().optional(),
  upi_id: z.string().max(80).nullable().optional(),
  eta_minutes: z.number().int().min(1).max(24 * 60).optional(),
  rush_surcharge_bps: z.number().int().min(0).max(5000).optional(),
  services: z.array(z.object({ service: z.enum(['print', 'photocopy', 'scan', 'bind', 'laminate']), enabled: z.boolean() })).optional(),
});

export const rateCardRowInput = z.object({
  service: z.enum(['print', 'photocopy', 'scan', 'bind', 'laminate']),
  paper_size: z.enum(PAPER_SIZES).nullable(),
  color: z.enum(['bw', 'color']).nullable(),
  sides: z.enum(['single', 'duplex']).nullable(),
  paper_gsm: z.number().int().min(40).max(300).nullable(),
  option: z.string().max(40).nullable(),
  unit: z.enum(['page', 'job', 'sheet']),
  price_paise: z.number().int().min(0).max(1_000_000),
});
export const rateCardPutInput = z.object({ rows: z.array(rateCardRowInput).min(1).max(120) });

export const statusTransitionInput = z.object({
  to: z.enum(['printing', 'ready', 'collected', 'queued', 'cancelled']),
  note: z.string().max(300).optional(),
});
export const confirmPaymentInput = z.object({ action: z.enum(['confirm', 'reject']), utr: z.string().max(40).optional() });
export const statusActionNote = z.object({ note: z.string().max(300).optional() });
