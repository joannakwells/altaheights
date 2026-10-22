import { createHmac, timingSafeEqual } from 'node:crypto';

export const SUCCESS = { success: true, message: 'Thanks, you are on the list.' };
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.email !== 'string' || typeof input.name !== 'string') return null;
  const email = input.email.trim().toLowerCase(), name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length > 200) return null;
  if (/[\u0000-\u001f\u007f]/.test(name + email)) return null;
  return { name, email };
}
export function authorized(header, secret) {
  if (!secret || secret.length < 32) return false;
  const supplied = Buffer.from(String(header || '')), expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function rateKey(ip, secret) {
  if (!secret || secret.length < 32) throw new Error('rate_limit_not_configured');
  return createHmac('sha256', secret).update(ip).digest('hex');
}
export async function deliverToSheet(record, { endpoint = process.env.SIGNUP_SHEET_URL, fetchImpl = fetch } = {}) {
  if (!endpoint) throw new Error('sheet_not_configured');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !url.pathname.endsWith('/exec')) {
    throw new Error('invalid_sheet_endpoint');
  }
  // Prefix spreadsheet formula characters to preserve names as text.
  const name = /^[=+\-@]/.test(record.name) ? `'${record.name}` : record.name;
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name, email: record.email, form_loaded_at: String(Date.now() - 10000) }),
    credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('sheet_unavailable');
  const result = await response.json();
  if (result.success !== true) throw new Error('sheet_rejected');
}
export async function syncOne(store, deliver = deliverToSheet, email = null) {
  const [record] = await store.claim(email);
  if (!record) return false;
  try {
    await deliver(record);
    await store.delivered(record.email);
  } catch {
    await store.retry(record.email, record.attempts);
    throw new Error('sheet_sync_failed');
  }
  return true;
}
export async function acceptSignup(record, { store, deliver = deliverToSheet, log = console.warn }) {
  await store.save(record); // Never acknowledge success before durable storage.
  try { await syncOne(store, deliver, record.email); }
  catch { log(JSON.stringify({ event: 'signup_sync_deferred' })); }
  return SUCCESS;
}
