import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Printly for Shops',
  description: 'Your print shop, in your pocket.',
  manifest: '/owner-app.webmanifest',
  robots: { index: false, follow: false },
};

export default function OwnerAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
