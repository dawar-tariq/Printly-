// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NotificationManagement } from './NotificationManagement';

const shopId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const releaseId = '44444444-4444-4444-8444-444444444444';
const uuid = '55555555-5555-4555-8555-555555555555';
const overview = { registered_devices: 2, active_devices: 1, registered_shops: 1, shops: 3, v2_devices: 1,
  accepted: 4, displayed: 2, failed: 1, pending: 1, worker_configured: true, release_manager_enabled: true,
  versions: [{ version_code: 5, version_name: '2.1.0', devices: 1 }], recent_activity: [] };
const campaign = { id: campaignId, title: 'Saved draft', message: 'A message', notification_type: 'general', tap_action: 'home', image_url: null,
  audience_kind: 'shops', shop_ids: [shopId], device_ids: [], target_version: null, revision: 3, status: 'draft', scheduled_at: null,
  created_at: '2026-01-01T00:00:00Z', source_kind: null, recipient_count: 0, accepted_count: 0, displayed_count: 0, failed_count: 0, pending_count: 0 };
const release = { id: releaseId, version_code: 5, version_name: '2.1.0', minimum_version_code: 4,
  apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk', apk_sha256: 'a'.repeat(64),
  certificate_sha256: 'b'.repeat(64), notes: 'Release notes', mandatory: false, released_at: '2026-01-01T00:00:00Z',
  revision: 0, published: false, is_current: false, first_published_at: null };
let calls: Array<{ url: URL; body?: Record<string, unknown> }>;
let campaigns: Array<Record<string, unknown>>;
let releases: Array<Record<string, unknown>>;
let failOverview: boolean;
let loseQueueResponse: boolean;
let queueReplay: boolean;
let loseRetryResponse: boolean;
let retryReplay: boolean;
let loseReleaseResponse: boolean;
let releaseReplay: boolean;
let queuePending: Promise<Response> | null;

beforeEach(() => {
  calls = []; campaigns = []; releases = [release]; failOverview = false; loseQueueResponse = false; queueReplay = false;
  loseRetryResponse = false; retryReplay = false; loseReleaseResponse = false; releaseReplay = false; queuePending = null;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
  vi.stubGlobal('fetch', vi.fn(async (address: string, init?: RequestInit) => {
    const url = new URL(address, 'https://printly.test');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (body.action === 'preview') return Response.json({ result: { eligible_devices: 1, eligible_shops: 1 } });
      if (body.action === 'save_campaign') return Response.json({ result: { id: body.id, revision: body.revision === null ? 0 : Number(body.revision) + 1 } });
      if (body.action === 'queue') {
        if (loseQueueResponse) { loseQueueResponse = false; throw new Error('Connection interrupted.'); }
        if (queuePending) return queuePending;
        return Response.json({ result: { status: 'scheduled', replayed: queueReplay } });
      }
      if (body.action === 'retry') {
        if (loseRetryResponse) { loseRetryResponse = false; throw new Error('Connection interrupted.'); }
        return Response.json({ result: { ok: true, retried: 1, replayed: retryReplay } });
      }
      if (['publish_release', 'activate_release', 'unpublish_release'].includes(String(body.action))) {
        if (loseReleaseResponse) { loseReleaseResponse = false; throw new Error('Connection interrupted.'); }
        return Response.json({ result: { ok: true, replayed: releaseReplay } });
      }
      return Response.json({ result: { ok: true, status: 'cancelled', retried: 1 } });
    }
    calls.push({ url });
    switch (url.searchParams.get('view')) {
      case 'overview': return failOverview ? Response.json({ error: { message: 'Overview is unavailable.' } }, { status: 503 }) : Response.json(overview);
      case 'targets': return Response.json({ shops: [{ id: shopId, name: url.searchParams.get('page') === '2' ? 'Second page shop' : 'First shop' }],
        devices: [{ binding_id: deviceId, shop_id: shopId, shop_name: 'First shop', app_version_code: 5, app_version_name: '2.1.0', push_protocol: 2, last_seen_at: '2026-01-01T00:00:00Z' }], page: Number(url.searchParams.get('page')), shop_count: 31, device_count: 1 });
      case 'campaigns': return Response.json({ campaigns, page: Number(url.searchParams.get('page')), count: campaigns.length, pages: 2 });
      case 'logs': return Response.json({ logs: [{ delivery_id: uuid, binding_id: deviceId, shop_id: shopId, outcome: 'sent', attempts: 1, displayed_at: null, updated_at: '2026-01-01T00:00:00Z' }], pages: 1 });
      case 'templates': return Response.json({ templates: [], pages: 1 });
      case 'releases': return Response.json({ releases, pages: 1 });
      default: throw new Error('Unexpected view');
    }
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const posts = () => calls.filter((call) => call.body).map((call) => call.body!);

describe('notification management console', () => {
  it('loads real counts and warns that acceptance and display do not prove reading', async () => {
    render(<NotificationManagement />);
    await screen.findByText('Registered devices');
    expect(screen.getByText('FCM accepted')).toBeTruthy();
    expect(screen.getByText('2 phone-reported displays')).toBeTruthy();
    expect(screen.getByText(/FCM acceptance is not delivery/)).toBeTruthy();
  });
  it('validates a draft, previews a selected shop and confirms before queueing', async () => {
    render(<NotificationManagement />);
    await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert').textContent).toMatch(/complete the title/i);
    expect(posts()).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('A clear, useful headline'), { target: { value: 'Shop notice' } });
    fireEvent.change(screen.getByPlaceholderText('Write the message shop owners will see.'), { target: { value: 'Hello shops' } });
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'shops' } });
    fireEvent.click(await screen.findByLabelText(/First shop/));
    fireEvent.click(screen.getByRole('button', { name: 'Estimate audience' }));
    await screen.findByText(/1 eligible devices/);
    expect(posts()[0]).toMatchObject({ action: 'preview', campaign: { audience_kind: 'shops', shop_ids: [shopId] } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    expect(posts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(posts()[1]).toMatchObject({ action: 'save_campaign', revision: null, campaign: { title: 'Shop notice', shop_ids: [shopId] } });
    expect(posts()[2]).toMatchObject({ action: 'queue', revision: 0, scheduled_at: null, request_id: uuid });
    expect(await screen.findByText(/Notification queued/)).toBeTruthy();
  });
  it('freezes message, audience and schedule fields while a queue request is in flight', async () => {
    let resolveQueue!: (response: Response) => void;
    queuePending = new Promise((resolve) => { resolveQueue = resolve; });
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    const title = screen.getByPlaceholderText('A clear, useful headline');
    fireEvent.change(title, { target: { value: 'Shop notice' } });
    fireEvent.change(screen.getByPlaceholderText('Write the message shop owners will see.'), { target: { value: 'Hello shops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(title.matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Audience').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText(/Future date and time/).matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Queueing/ }).hasAttribute('disabled')).toBe(true);
    resolveQueue(Response.json({ result: { status: 'scheduled' } }));
    expect(await screen.findByText(/Notification queued/)).toBeTruthy();
  });
  it('reuses the exact queue request after a lost response without silently applying edits', async () => {
    loseQueueResponse = true; queueReplay = true;
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    const title = screen.getByPlaceholderText('A clear, useful headline');
    fireEvent.change(title, { target: { value: 'Shop notice' } });
    fireEvent.change(screen.getByPlaceholderText('Write the message shop owners will see.'), { target: { value: 'Hello shops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/check History/i);
    expect(posts()).toHaveLength(2);
    fireEvent.change(title, { target: { value: 'Changed after timeout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    expect(screen.getByRole('alert').textContent).toMatch(/restore the same message/i);
    expect(posts()).toHaveLength(2);
    fireEvent.change(title, { target: { value: 'Shop notice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    expect(await screen.findByText(/request was already recorded/i)).toBeTruthy();
    expect(posts()).toHaveLength(3);
    expect(posts()[2]).toEqual(posts()[1]); // Same ID, revision, schedule and request ID; no second save.
  });
  it('paginates targets and retains selections across pages', async () => {
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'shops' } });
    fireEvent.click(await screen.findByLabelText(/First shop/));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Second page shop');
    expect(screen.getByText('1 selected · maximum 100')).toBeTruthy();
    expect(calls.some((call) => call.url.searchParams.get('view') === 'targets' && call.url.searchParams.get('page') === '2')).toBe(true);
  });
  it('edits a draft with its revision and shows delivery details and cancellation confirmation', async () => {
    campaigns = [campaign];
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));
    expect((screen.getByPlaceholderText('A clear, useful headline') as HTMLInputElement).value).toBe('Saved draft');
    fireEvent.change(screen.getByPlaceholderText('A clear, useful headline'), { target: { value: 'Edited draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ action: 'save_campaign', id: campaignId, revision: 3, campaign: { title: 'Edited draft' } });
    campaigns = [{ ...campaign, title: 'Sending notice', status: 'sending', pending_count: 1, revision: 4 }];
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Details & logs' }));
    const details = await screen.findByRole('heading', { name: 'Delivery details' });
    const section = details.closest('section')!;
    expect(within(section).getByText('FCM accepted')).toBeTruthy();
    expect(within(section).getByText('Not reported')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel remaining' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/already in flight.*cannot be recalled/i));
    expect(posts()[1]).toMatchObject({ action: 'cancel', id: campaignId, revision: 4 });
  });
  it('does not widen a duplicated update-eligible audience to every device', async () => {
    campaigns = [{ ...campaign, status: 'completed', audience_kind: 'update_eligible', shop_ids: [], target_version: 5, source_kind: 'app_release' }];
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    expect((screen.getByLabelText('Audience') as HTMLSelectElement).value).toBe('shops');
    fireEvent.click(screen.getByRole('button', { name: 'Queue notification' }));
    expect(screen.getByRole('alert').textContent).toMatch(/audience/i);
    expect(posts()).toHaveLength(0);
  });
  it('reuses the same failed-delivery retry request after a lost response', async () => {
    loseRetryResponse = true; retryReplay = true;
    campaigns = [{ ...campaign, status: 'completed', failed_count: 1 }];
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry eligible failures' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/check history/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry eligible failures' }));
    expect(await screen.findByText(/retry was already recorded/i)).toBeTruthy();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]).toEqual(posts()[0]);
  });
  it('requires review confirmation before marking a release published', async () => {
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'App updates' }));
    const publish = await screen.findByRole('button', { name: 'Mark published' });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(publish);
    expect(posts()).toHaveLength(0);
    fireEvent.click(publish);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/independently verify/i));
    expect(posts()[0]).toMatchObject({ action: 'publish_release', id: releaseId, revision: 0, notify: false, verification_confirmed: true });
  });
  it('keeps the exact release action and notification choice after a lost response', async () => {
    releases = [{ ...release, published: true, first_published_at: '2026-01-01T00:00:00Z', revision: 1 }];
    loseReleaseResponse = true; releaseReplay = true;
    render(<NotificationManagement />); await screen.findByText('Registered devices');
    fireEvent.click(screen.getByRole('button', { name: 'App updates' }));
    const setCurrent = await screen.findByRole('button', { name: 'Set current / rollback' });
    const notify = screen.getByRole('checkbox', { name: /When setting a release current/ });
    fireEvent.click(notify);
    fireEvent.click(setCurrent);
    expect((await screen.findByRole('alert')).textContent).toMatch(/may have completed/i);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ action: 'activate_release', revision: 1, notify: true, request_id: uuid });

    fireEvent.click(notify);
    fireEvent.click(setCurrent);
    expect(screen.getByRole('alert').textContent).toMatch(/same notification choice/i);
    expect(posts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(screen.getByRole('alert').textContent).toMatch(/previous release action may have completed/i);
    expect(posts()).toHaveLength(1);

    fireEvent.click(notify);
    fireEvent.click(setCurrent);
    expect(await screen.findByText(/action was already recorded/i)).toBeTruthy();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]).toEqual(posts()[0]);
  });
  it('shows an actionable overview error and retries without a page refresh', async () => {
    failOverview = true;
    render(<NotificationManagement />);
    expect((await screen.findByRole('alert')).textContent).toContain('Overview is unavailable.');
    failOverview = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Registered devices')).toBeTruthy();
  });
});
