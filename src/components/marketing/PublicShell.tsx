import { SiteHeader } from './SiteHeader';
import { LandingFooter } from './LandingFooter';
import styles from '@/app/landing.module.css';

export function PublicShell({ children, className = '', footer }: { children: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return <div className={`marketing min-h-screen ${styles.landingShell} ${className || styles.innerPage}`}>
    <a href="#main-content" className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-bold text-neutral-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
    <SiteHeader />
    {children}
    {footer ?? <LandingFooter />}
  </div>;
}
