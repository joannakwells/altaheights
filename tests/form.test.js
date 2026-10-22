import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('    if (mailingListForm && mailingListStatus) {'), html.lastIndexOf('  </script>'));
function harness(fetchImpl) {
  const input = { value: '' }, status = { textContent: '', dataset: {} }, button = { disabled: false };
  const form = { resets: 0, querySelector: () => button, reset() { this.resets++; }, addEventListener(_, handler) { this.submit = handler; } };
  const context = { mailingListForm: form, mailingListStatus: status, MAILING_LIST_ENDPOINT: '/api/signup',
    document: { querySelector: () => input }, Date, URLSearchParams, AbortSignal, TypeError, SyntaxError, fetch: fetchImpl,
    FormData: class { get(key) { return { name: 'Test', email: 'test@example.invalid', company: '', form_loaded_at: String(Date.now() - 10000) }[key]; } }
  };
  vm.runInNewContext(code, context);
  return { form, status, button };
}
test('form submits to own backend and clears only after confirmed success', async () => {
  let request;
  const h = harness(async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ success: true, message: 'Saved' }) }; });
  await h.form.submit({ preventDefault() {} });
  assert.equal(request.url, '/api/signup');
  assert.equal(request.options.method, 'POST');
  assert.equal(JSON.parse(request.options.body).email, 'test@example.invalid');
  assert.equal(h.form.resets, 1);
  assert.equal(h.status.dataset.state, 'success');
  assert.equal(h.button.disabled, false);
});
test('offline, timeout, invalid response and server errors preserve form inputs for retry', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('network offline'); },
    async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML'); } }),
    async () => ({ ok: false, json: async () => ({ success: false, message: 'Try again' }) })
  ]) {
    const h = harness(fetchImpl);
    await h.form.submit({ preventDefault() {} });
    assert.equal(h.form.resets, 0);
    assert.equal(h.status.dataset.state, 'error');
    assert.equal(h.button.disabled, false);
  }
});
