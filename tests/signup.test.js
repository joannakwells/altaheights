import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../lib/store.js';
import { acceptSignup, authorized, deliverToSheet, rateKey, syncOne, validate } from '../lib/signup.js';
import signupHandler from '../api/signup.js';
import maintenanceHandler from '../api/signup-maintenance.js';

const db = new PGlite();
await db.exec(await readFile(new URL('../db/signup.sql', import.meta.url), 'utf8'));
const store = createStore(async (sql, params) => (await db.query(sql, params)).rows);
const record = { name: 'Test Person', email: 'person@example.invalid' };

test('normalizes email, preserves international names, rejects malformed and oversized input', () => {
  assert.deepEqual(validate({ name: '  Chloé 山田 ', email: ' TEST@EXAMPLE.COM ' }), { name: 'Chloé 山田', email: 'test@example.com' });
  for (const input of [null, [], {}, { name: '', email: 'invalid' }, { name: 'x'.repeat(201), email: 'a@b.co' }, { name: '\nBad\u0000', email: 'a@b.co' }]) assert.equal(validate(input), null);
});
test('does not acknowledge success or attempt delivery when storage fails', async () => {
  let called = false;
  await assert.rejects(acceptSignup(record, { store: { save: async () => { throw Error('offline'); } }, deliver: async () => { called = true; } }));
  assert.equal(called, false);
});
test('persists signup during Google outage, retries later, then stops delivering', async () => {
  const result = await acceptSignup(record, { store, deliver: async () => { throw Error('offline'); }, log: () => {} });
  assert.equal(result.success, true);
  let row = (await db.query('SELECT * FROM mailing_list_signups WHERE email=$1', [record.email])).rows[0];
  assert.equal(row.synced_at, null);
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'sheet_unavailable');
  assert.equal(await syncOne(store, async () => {}), false, 'backoff prevents immediate retry');
  await db.query('UPDATE mailing_list_signups SET next_attempt_at=now() WHERE email=$1', [record.email]);
  let count = 0;
  assert.equal(await syncOne(store, async () => { count++; }), true);
  assert.equal(await syncOne(store, async () => { count++; }), false);
  assert.equal(count, 1);
  row = (await db.query('SELECT * FROM mailing_list_signups WHERE email=$1', [record.email])).rows[0];
  assert.ok(row.synced_at);
});
test('duplicate submissions are idempotent and do not overwrite the original name', async () => {
  await Promise.all(Array.from({ length: 5 }, () => store.save({ ...record, name: 'Changed' })));
  const rows = (await db.query('SELECT * FROM mailing_list_signups WHERE email=$1', [record.email])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, record.name);
});
test('only one worker claims each pending signup and expired leases recover', async () => {
  const email = 'lease@example.invalid';
  await store.save({ name: 'Lease', email });
  const claims = await Promise.all([store.claim(email), store.claim(email)]);
  assert.equal(claims.flat().length, 1);
  assert.equal((await store.claim(email)).length, 0);
  await db.query("UPDATE mailing_list_signups SET lease_until=now()-interval '1 minute' WHERE email=$1", [email]);
  assert.equal((await store.claim(email)).length, 1);
  await store.delivered(email);
});
test('rate limits use persistent atomic counters and expire', async () => {
  const key = rateKey('192.0.2.1', 's'.repeat(32));
  assert.ok(!key.includes('192.0.2.1'));
  const results = await Promise.all(Array.from({ length: 61 }, () => store.allow(key)));
  assert.equal(results.filter(Boolean).length, 60);
  await db.query("UPDATE mailing_list_limits SET expires_at=now()-interval '1 minute' WHERE key=$1", [key]);
  assert.equal(await store.allow(key), true);
});
test('health verifies database writes and detects overdue Google deliveries', async () => {
  await store.save({ name: 'Overdue', email: 'overdue@example.invalid' });
  await db.query("UPDATE mailing_list_signups SET created_at=now()-interval '20 minutes' WHERE email=$1", ['overdue@example.invalid']);
  const result = await store.health('test-health');
  assert.equal(result.overdue, 1);
  assert.equal((await db.query('SELECT * FROM mailing_list_health')).rows.length, 0);
});
test('Google adapter uses a cookie-free POST and rejects false or malformed success', async () => {
  const endpoint = 'https://script.google.com/macros/s/test/exec';
  let options;
  await deliverToSheet({ ...record, name: '=SUM(1,2)' }, { endpoint, fetchImpl: async (_, opts) => {
    options = opts; return { ok: true, json: async () => ({ success: true }) };
  } });
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.body.get('name'), "'=SUM(1,2)");
  assert.equal(options.body.has('callback'), false);
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ success: false }) }, { ok: true, json: async () => { throw Error('HTML response'); } }]) {
    await assert.rejects(deliverToSheet(record, { endpoint, fetchImpl: async () => response }));
  }
});
test('maintenance authentication fails closed', () => {
  assert.equal(authorized(undefined, undefined), false);
  assert.equal(authorized('Bearer short', 'short'), false);
  assert.equal(authorized('Bearer ' + 'a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(authorized('Bearer ' + 'a'.repeat(32), 'a'.repeat(32)), true);
});
function response() {
  return { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
}
test('HTTP boundary rejects wrong methods, origin, content type and invalid data', async () => {
  const good = { method: 'POST', headers: { origin: 'https://www.altaheightswine.com', 'content-type': 'application/json' }, body: record };
  for (const [request, expected] of [
    [{ ...good, method: 'GET' }, 405],
    [{ ...good, headers: { ...good.headers, origin: 'https://untrusted.invalid' } }, 403],
    [{ ...good, headers: { ...good.headers, 'content-type': 'text/plain' } }, 415],
    [{ ...good, body: { name: '', email: 'bad' } }, 400],
    [{ ...good, body: { name: 'x'.repeat(4097) } }, 413]
  ]) { const res = response(); await signupHandler(request, res); assert.equal(res.code, expected); }
  const res = response(); await maintenanceHandler({ method: 'POST', headers: {} }, res); assert.equal(res.code, 401);
});
test('honeypot does not create a database record', async () => {
  const res = response();
  await signupHandler({ method: 'POST', headers: { origin: 'https://www.altaheightswine.com', 'content-type': 'application/json' }, body: { ...record, company: 'robot' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
});
test.after(async () => { await db.close(); });
