import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { PolicyPage, type PolicySection } from '@/components/marketing/PolicyPage';

export const metadata: Metadata = { alternates: publicCanonical('/cookies'), title: 'Cookie notice | Printly', description: 'How Printly uses essential cookies and browser storage.' };

const sections: PolicySection[] = [
  { id: 'what', title: 'What are cookies?', content: <><p>Cookies are small pieces of information stored by your browser. A website can also use browser storage for information that helps a page work during a visit.</p></> },
  { id: 'use', title: 'How Printly uses them', content: <><p>Printly uses essential cookies and browser storage for service functions, including:</p><ul><li>Keeping a shop or administrator signed in through the authentication service.</li><li>Associating an order draft with the browser that created it. The draft capability is designed to expire after 24 hours.</li><li>Remembering, for a browser session, whether a subscription reminder has already been shown.</li></ul><p>Hosting, authentication, payment and optional third-party services may use their own technical storage or logs when you interact with them.</p></> },
  { id: 'choices', title: 'Your browser choices', content: <><p>You can manage or clear cookies and browser storage in your browser settings. Blocking or clearing essential storage can sign you out, interrupt an order draft or cause an existing draft to require a restart. Browser settings vary by device.</p></> },
  { id: 'more', title: 'More information', content: <><p>See the <Link href="/privacy">privacy policy</Link> for more about information handled by the service, or visit <Link href="/contact">contact & help</Link> for available support information.</p></> },
];

export default function CookiesPage() { return <PolicyPage eyebrow="The small things that make the site work" title="Cookie notice" description="What Printly uses cookies and browser storage for, and what happens if you clear or block them." sections={sections} />; }
