export type FaqItem = { id: string; question: string; answer: string };
export type FaqGroup = { title: string; items: FaqItem[] };

export const faqGroups: FaqGroup[] = [
  { title: 'For customers', items: [
    { id: 'get-started', question: 'How do I place a print order?', answer: 'Open a participating shop’s QR code or link, choose a service, upload your files when needed, and review the options and price before checkout. Save your tracking link so you can follow the order.' },
    { id: 'app', question: 'Do I need to download an app?', answer: 'No. Printly works in a compatible web browser on your phone or computer.' },
    { id: 'files', question: 'Which files can I upload?', answer: 'PDF, Word, JPEG and PNG files are supported, up to 25 MiB per file and 10 files per order. Word page counts need to be entered by the customer; check the layout and final print with the shop.' },
    { id: 'prices', question: 'How much does printing cost?', answer: 'Each shop sets its own rates. The order screen shows a quote before checkout, including any applicable tax or rush charge configured for the order.' },
    { id: 'customer-payments', question: 'How do I pay for an order?', answer: 'Pay the shop directly by UPI or choose cash where available. A UPI payment report is not confirmation: the shop must independently verify the transfer.' },
    { id: 'tracking', question: 'How will I know when my order is ready?', answer: 'Save and revisit your tracking link to see updates from the shop. Printly does not currently send automatic email or SMS order notifications.' },
    { id: 'cancellations', question: 'Can I cancel an order or request a refund?', answer: 'Contact the shop as soon as possible about changes, cancellations or print-quality issues. Cancelling an order does not automatically return a payment; any refund must be handled separately.' },
    { id: 'demo', question: 'Is the demo shop a simulation?', answer: 'The demo shop is a live shop with real checkout options, not a payment simulator. Do not upload sensitive files or send a payment unless you intend to place a real order.' },
  ] },
  { title: 'For shop owners', items: [
    { id: 'join', question: 'How do I get my shop on Printly?', answer: 'Submit a shop application with your details and services. Your shop needs approval and an active subscription before it can accept new orders.' },
    { id: 'subscription', question: 'What is included in the subscription?', answer: 'One all-features shop plan is available in monthly, six-month and yearly terms. The terms include the same features; see the pricing page for the currently configured amounts.' },
    { id: 'subscription-payment', question: 'How does subscription payment work?', answer: 'The shop owner reviews a term and can apply an eligible promo code. If a balance remains, they send a one-time UPI payment and submit its reference; Printly independently verifies and approves the transfer before activating access. A fully discounted term activates immediately without payment. There is no automatic recurring charge.' },
    { id: 'commission', question: 'Does Printly take a commission on customer orders?', answer: 'Printly does not charge a platform commission on new customer orders. Customers pay the shop directly; charges from banks or payment providers, if any, are separate.' },
    { id: 'expiry', question: 'What happens if my subscription expires?', answer: 'New orders and the regular shop dashboard are paused. Staff can still use the recovery area for open orders and payment issues. A paid renewal restores access after verification and approval; an eligible fully discounted term activates immediately.' },
    { id: 'privacy', question: 'Who can access an uploaded file?', answer: 'Order files are kept in private storage and made available to authorised shop staff for the order. Keep tracking links private, and avoid uploading documents more sensitive than the service requires.' },
  ] },
];

export const landingFaqIds = ['get-started', 'app', 'prices', 'join', 'subscription-payment', 'privacy'];
export const landingFaqs = faqGroups.flatMap((group) => group.items).filter((item) => landingFaqIds.includes(item.id));
