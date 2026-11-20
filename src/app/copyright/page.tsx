import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { PolicyPage, type PolicySection } from '@/components/marketing/PolicyPage';

export const metadata: Metadata = { alternates: publicCanonical('/copyright'), title: 'Copyright | Printly', description: 'Information about Printly branding, service materials and the content you provide.' };

const sections: PolicySection[] = [
  { id: 'printly', title: 'Printly materials', content: <><p>Unless otherwise noted, the Printly name, branding, website design and service materials are protected by copyright and other applicable intellectual-property laws. All rights are reserved, subject to any licences that apply to particular third-party components.</p><p>You may use the service and its materials as needed for their intended purpose. Please do not copy, sell or present Printly’s branding or materials as your own without permission.</p></> },
  { id: 'your-content', title: 'Your content', content: <><p>Files you provide remain your content or the content of their respective rights holders. You are responsible for having the rights and permissions needed to upload, share and print them. Using Printly does not transfer ownership of your documents to Printly or the print shop.</p><p>You allow the service and the shop you choose to process the files as needed to handle your order, such as storing, displaying, downloading and printing them.</p></> },
  { id: 'third-party', title: 'Third-party materials', content: <><p>Other names, marks, software and materials may belong to their respective owners and may be subject to separate licences or terms. References to third-party services are for identification, not an endorsement.</p></> },
  { id: 'concerns', title: 'Questions or concerns', content: <><p>For an issue involving a particular order, contact the relevant shop. For platform concerns, see <Link href="/contact">contact & help</Link> for the contact information currently available.</p></> },
];

export default function CopyrightPage() { return <PolicyPage eyebrow="Respecting creative work" title="Copyright" description="A note about Printly’s materials, the files you provide and the rights of others." sections={sections} />; }
