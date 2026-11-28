import { afterEach, describe, expect, it, vi } from 'vitest';
import AffiliatePage from './affiliate/page';
import AffiliateDashboardPage from './affiliate/dashboard/page';
import ReferralPage from './refer/page';
import OwnerReferralsPage from './shop/(workspace)/referrals/page';
import AdminAffiliatesPage from './admin/(console)/affiliates/page';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
const original = process.env.PRINTLY_ISOLATED_TEST;
afterEach(() => { if (original === undefined) delete process.env.PRINTLY_ISOLATED_TEST; else process.env.PRINTLY_ISOLATED_TEST = original; });

describe('unfinished marketing previews', () => {
  it.each([AffiliatePage, AffiliateDashboardPage, ReferralPage, OwnerReferralsPage, AdminAffiliatesPage])('does not render outside the isolated test environment', (page) => {
    delete process.env.PRINTLY_ISOLATED_TEST;
    expect(() => page()).toThrow('NOT_FOUND');
    process.env.PRINTLY_ISOLATED_TEST = 'true';
    expect(() => page()).toThrow('NOT_FOUND');
  });
  it.each([AffiliatePage, AffiliateDashboardPage, ReferralPage, OwnerReferralsPage, AdminAffiliatesPage])('renders only with the explicit isolated-test flag', (page) => {
    process.env.PRINTLY_ISOLATED_TEST = '1';
    expect(page()).toBeTruthy();
  });
});
