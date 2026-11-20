import type { Metadata } from 'next';
import Link from 'next/link';
import { PolicyPage, type PolicySection } from '@/components/marketing/PolicyPage';

export const metadata: Metadata = { title: 'Security | Printly', description: 'Practical information about Printly security, private file storage and protecting your account and orders.' };

const sections: PolicySection[] = [
  { id: 'approach', title: 'Our approach', content: <><p>Printly is designed to limit access to the information needed for an order or shop account. Security is an ongoing process, not a guarantee that risk can be eliminated.</p></> },
  { id: 'files', title: 'Files and order access', content: <><p>Order files and shop name-proof photos are stored in private buckets. Authorised shop staff can access files for their shop’s orders, and administrators may access information as needed to operate and support the service. The application uses short-lived links when opening or downloading order files; a downloaded or printed copy can still be retained outside Printly.</p><p>Order tracking links provide access to order status and certain details. Treat the link like a password: share it only with people you trust. A tracking link alone does not provide access to the draft’s files.</p></> },
  { id: 'accounts', title: 'Protecting your account', content: <><ul><li>Use a unique, strong password for your shop account. Do not reuse a demo password.</li><li>Only give shop access to people who need it, and sign out on shared devices.</li><li>Check the recipient and amount in your UPI app before sending money. Neither an on-screen reference nor a payment report proves that funds arrived.</li><li>Avoid uploading highly sensitive documents unless you trust the shop to handle them. PDF cropping is not redaction.</li></ul></> },
  { id: 'payments', title: 'Payment checks', content: <><p>Customer payments are made to the shop; shop subscription payments are made separately to Printly. Shop staff verify customer UPI payments, and an administrator independently verifies subscription transfers before approving paid access. If you may already have paid, check the request or speak with the relevant party before sending money again.</p></> },
  { id: 'report', title: 'Reporting a concern', content: <><p>For an order, contact the shop using the details on its page. For account, platform or privacy concerns, see <Link href="/contact">contact & help</Link>. A public Printly support email is not currently listed; please avoid posting passwords, tracking links or document contents in public.</p></> },
];

export default function SecurityPage() { return <PolicyPage eyebrow="Trust, made practical" title="Security at Printly" description="How the service approaches security, and the simple steps you can take to protect your information." sections={sections} />; }
