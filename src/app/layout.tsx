import type { Metadata, Viewport } from 'next';
import { MaintenanceGuard } from '@/components/MaintenanceGuard';
import './globals.css';

const metadataBase = (() => {
  try { return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined; }
  catch { return undefined; }
})();

export const metadata: Metadata = {
  metadataBase,
  title: 'Printly — Scan QR · Upload · Pay · Collect',
  description: 'The simplest way to get documents printed at local Indian print shops. Scan the shop QR, upload your file, pay via UPI, collect with a token. No app, no queue.',
  applicationName: 'Printly',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: 'any' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Printly — Scan QR · Upload · Pay · Collect',
    description: 'The simplest way to get documents printed at local Indian print shops.',
    siteName: 'Printly',
    type: 'website',
    images: [{ url: '/brand/printly-share.png', width: 1200, height: 630, alt: 'Printly — Print anything. Skip the queue.' }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/printly-share.png'] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#c2410c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased"><MaintenanceGuard>{children}</MaintenanceGuard></body>
    </html>
  );
}
