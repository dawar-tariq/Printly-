export type MaintenanceNotice = 'maintenance' | 'unavailable';

export const MAINTENANCE_STATUS_PATH = '/api/maintenance-status';
export const MAINTENANCE_CHECK_INTERVAL_MS = 30_000;

export const MAINTENANCE_COPY: Record<MaintenanceNotice, { label: string; title: string; message: string }> = {
  maintenance: {
    label: 'Maintenance in progress',
    title: 'We’re making things better',
    message: 'Printly is temporarily unavailable while we make improvements. Please check back soon.',
  },
  unavailable: {
    label: 'Temporarily unavailable',
    title: 'We’ll be back soon',
    message: 'We can’t reach Printly right now. Please check your connection and try again shortly.',
  },
};

export const MAINTENANCE_PAYMENT_NOTE = 'Already paid? Please don’t pay again. Keep your tracking link and contact your print shop if you need help.';

export function isAdminPage(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

export function isAdminApi(path: string): boolean {
  return path === '/api/admin' || path.startsWith('/api/admin/');
}
