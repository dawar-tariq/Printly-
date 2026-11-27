import { describe, expect, it } from 'vitest';
import { renderPrintlyEmail, type PrintlyEmailKind } from './transactional-email-templates';

const kinds: PrintlyEmailKind[] = ['welcome', 'application_received', 'under_review', 'changes_requested', 'verified', 'not_approved', 'account_suspended', 'account_reactivated', 'subscription_active', 'subscription_expiring', 'subscription_expired', 'subscription_payment_submitted', 'subscription_payment_rejected'];
describe('Printly transactional email templates', () => {
  it.each(kinds)('%s has branded HTML, accessible logo, safe links and plain text', (kind) => {
    const email = renderPrintlyEmail(kind, 'Shop Owner');
    expect(email.subject).toBeTruthy();
    expect(email.html).toContain('alt="Printly"');
    expect(email.html).toContain('https://printly0.vercel.app/brand/printly-logo-on-white.png');
    expect(email.html).toContain('https://printly0.vercel.app/shop');
    expect(email.text).toContain('Shop Owner');
    expect(email.text).toContain('https://printly0.vercel.app/contact');
  });
  it('escapes names in HTML', () => {
    const email = renderPrintlyEmail('welcome', '<img src=x onerror="alert(1)">');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x');
  });
  it('does not equate verification with order eligibility', () => {
    expect(renderPrintlyEmail('verified').text).toContain('subscription access are checked separately');
  });
  it('fails closed for unknown types', () => expect(() => renderPrintlyEmail('unknown' as PrintlyEmailKind)).toThrow());
});
