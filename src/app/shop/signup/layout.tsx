import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';

export const metadata: Metadata = { alternates: publicCanonical('/shop/signup') };

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
