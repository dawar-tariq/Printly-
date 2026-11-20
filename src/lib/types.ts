export type OrderStatus = 'draft' | 'queued' | 'printing' | 'ready' | 'collected' | 'cancelled' | 'failed';
export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'cod_pending' | 'cod_collected';
export type PaymentMethod = 'upi' | 'cod';

export interface RateRow {
  service: string;
  paper_size: string | null;
  color: string | null;
  sides: string | null;
  paper_gsm: number | null;
  option: string | null;
  unit: 'page' | 'job' | 'sheet';
  price_paise: number;
}

export interface OrderItem extends RateRow {
  id: string;
  file_id: string | null;
  copies: number;
  pages: number;
  binding: string;
  lamination: boolean;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface ShopRow {
  id: string;
  owner_id: string;
  slug: string;
  short_code: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  gstin: string | null;
  upi_id: string | null;
  kyc_status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  status: 'active' | 'paused' | 'suspended';
  rush_surcharge_bps: number;
  eta_minutes: number;
  rating_avg: number;
  rating_count: number;
  created_at: string;
}
