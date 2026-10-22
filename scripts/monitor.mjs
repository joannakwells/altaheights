const origin = process.env.SIGNUP_SITE_URL || 'https://www.altaheightswine.com';
const secret = process.env.SIGNUP_MONITOR_SECRET;
if (!secret || secret.length < 32) throw new Error('Configure SIGNUP_MONITOR_SECRET before enabling monitoring.');
const response = await fetch(new URL('/api/signup-maintenance', origin), {
  method: 'POST', headers: { Authorization: `Bearer ${secret}` },
  redirect: 'error', signal: AbortSignal.timeout(65000)
});
if (!response.ok) throw new Error(`Signup maintenance failed: HTTP ${response.status}`);
const result = await response.json();
if (result.ok !== true) throw new Error('Signup maintenance returned an unsuccessful response.');
console.log(JSON.stringify({ ok: true, pending: result.pending, overdue: result.overdue }));
