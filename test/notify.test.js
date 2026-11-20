/* Unit tests for notify.js (SMTP client, SOL conversion, message templates). No internet needed.   Run:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../notify.js');

const { fakeSmtp, bodyOf } = require('./fake-smtp.js');

test('smtpSend delivers a message (login, subject, UTF-8 body)', async () => {
  const s = await fakeSmtp({ requireAuth: true });
  await notify.smtpSend({ host: '127.0.0.1', port: s.port, secure: 'none', user: 'me@x.test', pass: 'secret', to: ['boss@x.test'], subject: 'Fee ₱ received', text: 'Total: 0.1 SOL (₱ 345.00)' });
  s.close();
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0].to[0], '<boss@x.test>');
  assert.match(s.mails[0].raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.equal(bodyOf(s.mails[0].raw), 'Total: 0.1 SOL (₱ 345.00)');
});
test('smtpSend explains a wrong password and a refused recipient', async () => {
  const s = await fakeSmtp({ requireAuth: true });
  await assert.rejects(notify.smtpSend({ host: '127.0.0.1', port: s.port, secure: 'none', user: 'me@x.test', pass: 'WRONG', to: ['a@x.test'], subject: 's', text: 't' }), /user name and password/);
  s.close();
  const s2 = await fakeSmtp({ rejectRcpt: true });
  await assert.rejects(notify.smtpSend({ host: '127.0.0.1', port: s2.port, secure: 'none', from: 'me@x.test', to: ['a@x.test'], subject: 's', text: 't' }), /no such user/);
  s2.close();
});
test('smtpSend cannot be tricked into header injection', async () => {
  const s = await fakeSmtp();
  await notify.smtpSend({ host: '127.0.0.1', port: s.port, secure: 'none', from: 'me@x.test', to: ['a@x.test'], subject: 'Hi\r\nBcc: evil@x.test', text: 't' });
  s.close();
  assert.doesNotMatch(s.mails[0].raw, /^Bcc:/m);
});
test('smtpSend reports a server that is not there', async () => {
  await assert.rejects(notify.smtpSend({ host: '127.0.0.1', port: 1, secure: 'none', from: 'me@x.test', to: ['a@x.test'], subject: 's', text: 't' }), /Could not connect/);
});

test('SOL is converted to PHP, USD or both', () => {
  const price = { usd: 150, php: 8700 };
  assert.equal(notify.convertedText(0.5, 'PHP', price), '₱4,350.00');
  assert.equal(notify.convertedText(0.5, 'USD', price), '$75.00');
  assert.equal(notify.convertedText(0.5, 'BOTH', price), '₱4,350.00 / $75.00');
  assert.equal(notify.convertedText(0.5, 'PHP', null), 'price unavailable');
});
test('the SOL price is cached, and an old price is used when the lookup fails', async () => {
  notify.setPriceCacheForTests({ at: 0, usd: 0, php: 0 });
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ solana: { usd: 100, php: 5800 } }) }; };
  assert.deepEqual({ ...(await notify.getSolPrice(ok)), at: 0 }, { usd: 100, php: 5800, at: 0 });
  await notify.getSolPrice(ok); assert.equal(calls, 1);                                  // second call came from the cache
  notify.setPriceCacheForTests({ at: Date.now() - 3_600_000, usd: 100, php: 5800 });     // stale but usable
  const down = async () => { throw new Error('offline'); };
  assert.equal((await notify.getSolPrice(down)).php, 5800);
  notify.setPriceCacheForTests({ at: 0, usd: 0, php: 0 });
  assert.equal(await notify.getSolPrice(down), null);
});
test('placeholders are filled and unknown ones stay visible', () => {
  assert.equal(notify.render('Fee {sol} SOL = {converted} {oops}', { sol: '0.1', converted: '₱5' }), 'Fee 0.1 SOL = ₱5 {oops}');
});
test('recipient lists are cleaned', () => {
  assert.deepEqual(notify.parseRecipients('a@x.com, b@y.org ; nope'), { list: ['a@x.com', 'b@y.org'], bad: ['nope'] });
});

/* ---------- Resend (HTTPS) ---------- */
const http = require('node:http');
function fakeResend(handler) {
  return new Promise(resolve => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => { calls.push({ method: req.method, auth: req.headers.authorization, json: JSON.parse(body || 'null') }); const [code, obj] = handler(calls.length); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); });
    }).listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + srv.address().port + '/emails', calls, close: () => srv.close() }));
  });
}
test('resendSend posts the message over HTTPS with the API key', async () => {
  const r = await fakeResend(() => [200, { id: 'abc' }]);
  await notify.resendSend({ apiKey: 're_testkey123456', from: 'MemeForge <onboarding@resend.dev>', to: ['boss@x.test', 'Me <me@x.test>'], subject: 'Fee ₱ received\r\nBcc: evil@x.test', text: 'Total: 0.1 SOL', url: r.url });
  r.close();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].method, 'POST'); assert.equal(r.calls[0].auth, 'Bearer re_testkey123456');
  assert.deepEqual(r.calls[0].json.to, ['boss@x.test', 'me@x.test']);
  assert.equal(r.calls[0].json.from, 'MemeForge <onboarding@resend.dev>'); assert.equal(r.calls[0].json.text, 'Total: 0.1 SOL');
  assert.doesNotMatch(r.calls[0].json.subject, /[\r\n]/);
});
test('resendSend explains a wrong key, a refusal, a missing key and an unreachable server', async () => {
  const r401 = await fakeResend(() => [401, { message: 'API key is invalid' }]);
  await assert.rejects(notify.resendSend({ apiKey: 're_x1234567890', from: 'a@x.test', to: ['b@x.test'], subject: 's', text: 't', url: r401.url }), /did not accept the API key/);
  r401.close();
  const r403 = await fakeResend(() => [403, { message: 'You can only send testing emails to your own email address' }]);
  await assert.rejects(notify.resendSend({ apiKey: 're_x1234567890', from: 'a@x.test', to: ['b@x.test'], subject: 's', text: 't', url: r403.url }), /refused the e-mail: You can only send testing emails/);
  r403.close();
  await assert.rejects(notify.resendSend({ from: 'a@x.test', to: ['b@x.test'], subject: 's', text: 't' }), /API key is not set/);
  await assert.rejects(notify.resendSend({ apiKey: 're_x1234567890', from: 'a@x.test', to: ['b@x.test'], subject: 's', text: 't', url: 'http://127.0.0.1:1/emails' }), /Could not reach Resend/);
});
