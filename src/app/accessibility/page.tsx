import type { Metadata } from 'next';
import Link from 'next/link';
import { PolicyPage, type PolicySection } from '@/components/marketing/PolicyPage';

export const metadata: Metadata = { title: 'Accessibility | Printly', description: 'Our approach to making Printly easier to use across devices and abilities.' };

const sections: PolicySection[] = [
  { id: 'approach', title: 'Our approach', content: <><p>Printly aims to be usable by as many people as possible, across different devices and abilities. We use readable text, labelled controls and keyboard-accessible navigation where practical, and continue to improve the experience.</p><p>Different browsers, assistive technologies, printers and file formats can behave differently. We have not represented the service as independently certified to a particular accessibility standard.</p></> },
  { id: 'tips', title: 'Ways to make the site easier to use', content: <><p>You can zoom in with your browser or device settings, navigate using a keyboard, and use the built-in features of your screen reader. Some document preview and printing features depend on browser and device support. If a file cannot be previewed, ask the shop about another way to handle it.</p></> },
  { id: 'feedback', title: 'Feedback and help', content: <><p>If you encounter an issue with an order, contact the shop using its public details. For platform-related feedback, see <Link href="/contact">contact & help</Link>; a public Printly support email is not currently listed.</p></> },
];

export default function AccessibilityPage() { return <PolicyPage eyebrow="A better experience for more people" title="Accessibility" description="Our approach to making Printly easier to navigate and use." sections={sections} />; }
