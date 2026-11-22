// Admin sign-in must remain available while maintenance mode is enabled.
// Both portals consume the same per-IP bucket.
export { POST } from '@/app/api/auth/login-attempt/route';
