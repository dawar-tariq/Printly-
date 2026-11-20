import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="marketing min-h-screen">
    <a href="#main-content" className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-bold text-neutral-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
    <SiteHeader />
    {children}
    <SiteFooter />
  </div>;
}
