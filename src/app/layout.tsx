import type { Metadata, Viewport } from 'next';
import { MaintenanceGuard } from '@/components/MaintenanceGuard';
import { siteOrigin } from '@/lib/site-origin';
import './globals.css';

const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
const metadataBase = origin ? new URL(origin) : undefined;

export const metadata: Metadata = {
  metadataBase,
  title: 'Printly — Less waiting. More doing.',
  description: 'A simpler way to order from your local print shop. Scan, upload, pay the shop directly and follow your order—right from your browser.',
  applicationName: 'Printly',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: 'any' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Printly — Less waiting. More doing.',
    description: 'A simpler way to order from your local print shop, and thoughtful tools for the shops behind it all.',
    siteName: 'Printly',
    type: 'website',
    ...(origin ? { images: [{ url: '/brand/printly-share.png', width: 1200, height: 630, alt: 'Printly — Print anything. Skip the queue.' }] } : {}),
  },
  twitter: { card: 'summary_large_image', ...(origin ? { images: ['/brand/printly-share.png'] } : {}) },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#c2410c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased"><MaintenanceGuard>{children}</MaintenanceGuard></body>
    </html>
  );
}
