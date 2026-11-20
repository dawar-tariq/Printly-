import type { Metadata } from 'next';
import Link from 'next/link';
import { PolicyPage, type PolicySection } from '@/components/marketing/PolicyPage';

export const metadata: Metadata = { title: 'Refunds & cancellations | Printly', description: 'What to do about order cancellations, payment issues and subscription requests.' };

const sections: PolicySection[] = [
  { id: 'orders', title: 'Customer orders', content: <><p>Your print order is fulfilled by the shop you choose, and customer order payments are made directly to that shop. Contact the shop as soon as possible about a change, cancellation, print-quality issue or refund. Its contact details are shown on its shop page.</p><p>Cancelling an order in the service does not automatically send money back. Any refund or adjustment must be handled separately with the shop and, where relevant, your payment provider. Save your order tracking link and payment reference when asking for help.</p></> },
  { id: 'subscription', title: 'Shop subscriptions', content: <><p>A shop owner can cancel an unpaid subscription request. If you have already sent a UPI transfer, do not cancel it as unpaid or send another payment; submit the reference for review or seek help before taking further action. Submitting a reference does not automatically activate access.</p><p>Subscription payment issues and any refund requests require manual handling. A public Printly support email is not currently listed; see <Link href="/contact">contact & help</Link> for the information currently available.</p></> },
  { id: 'rights', title: 'Your rights', content: <><p>Nothing on this page is intended to remove any rights you may have under applicable law. The specific circumstances of a request matter.</p></> },
];

export default function RefundsPage() { return <PolicyPage eyebrow="When plans change" title="Refunds & cancellations" description="A straightforward guide to who handles an order issue and what to do if a payment has already been sent." sections={sections} />; }
