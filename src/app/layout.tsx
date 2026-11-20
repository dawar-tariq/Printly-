import type { Metadata, Viewport } from 'next';
import { MaintenanceGuard } from '@/components/MaintenanceGuard';
import './globals.css';

export const metadata: Metadata = {
  title: 'Printly — Scan QR · Upload · Pay · Collect',
  description: 'The simplest way to get documents printed at local Indian print shops. Scan the shop QR, upload your file, pay via UPI, collect with a token. No app, no queue.',
  applicationName: 'Printly',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#c2410c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased"><MaintenanceGuard>{children}</MaintenanceGuard></body>
    </html>
  );
}
