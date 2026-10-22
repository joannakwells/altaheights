import { randomUUID } from 'node:crypto';
import { configuredStore } from '../lib/store.js';
import { authorized, deliverToSheet, syncOne } from '../lib/signup.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  if (!authorized(req.headers.authorization, process.env.SIGNUP_MONITOR_SECRET)) return res.status(401).json({ ok: false });
  try {
    const store = configuredStore();
    for (let i = 0; i < 4; i++) {
      try { if (!await syncOne(store)) break; } catch { break; }
    }
    const health = await store.health(randomUUID());
    // This fixed diagnostic address already exists in the Sheet. No real subscriber data is returned.
    await deliverToSheet({ name: 'Signup Diagnostic Test', email: 'signup-diagnostic@example.invalid' });
    if (health.overdue) return res.status(503).json({ ok: false, code: 'sheet_backlog', ...health });
    return res.status(200).json({ ok: true, ...health });
  } catch {
    console.error(JSON.stringify({ event: 'signup_health_failed' }));
    return res.status(503).json({ ok: false, code: 'dependency_unavailable' });
  }
}
