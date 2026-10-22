import { randomUUID } from 'node:crypto';
import { configuredStore } from '../lib/store.js';
import { acceptSignup, rateKey, SUCCESS, validate } from '../lib/signup.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false }); }
  const allowed = (process.env.SIGNUP_ALLOWED_ORIGINS || 'https://www.altaheightswine.com,https://altaheightswine.com').split(',');
  if (!allowed.includes(req.headers.origin)) return res.status(403).json({ success: false, message: 'Please use the signup form on our website.' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ success: false });
  const body = req.body;
  if (Buffer.byteLength(JSON.stringify(body ?? '')) > 4096) return res.status(413).json({ success: false });
  if (typeof body?.company === 'string' && body.company.trim()) return res.status(200).json(SUCCESS);
  const record = validate(body);
  if (!record) return res.status(400).json({ success: false, message: 'Please check your name and email address.' });
  const requestId = randomUUID();
  try {
    const store = configuredStore();
    // Vercel overwrites x-forwarded-for with the client IP; do not trust user-supplied body fields.
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (!await store.allow(rateKey(ip, process.env.SIGNUP_RATE_SECRET))) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
    }
    const result = await acceptSignup(record, { store });
    console.info(JSON.stringify({ event: 'signup_saved', requestId }));
    return res.status(200).json(result);
  } catch {
    console.error(JSON.stringify({ event: 'signup_storage_failed', requestId }));
    return res.status(503).json({ success: false, message: 'We could not confirm your signup. Please try again shortly.' });
  }
}
