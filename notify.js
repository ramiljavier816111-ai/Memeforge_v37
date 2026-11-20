/* =====================================================================
   MemeForge — notify.js   (zero dependencies)

   Everything the "fee received" e-mail needs, kept out of server.js so it can be tested alone:
     smtpSend()    a tiny SMTP client (implicit TLS on 465, STARTTLS on 587, or plain for local testing)
     resendSend()  sends through Resend's HTTPS API instead (port 443). Use it where SMTP is blocked, e.g. Railway Free / Hobby plans
     getSolPrice() live SOL price in USD and PHP (CoinGecko), cached for 5 minutes
     render()      fills {placeholders} in the message the admin wrote
   ===================================================================== */
'use strict';

const net = require('node:net');
const tls = require('node:tls');

const clean = s => String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();           // header values can never contain a line break
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/(.{76})/g, '$1\r\n');
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
const addrOnly = s => { const m = /<([^<>\s]+)>/.exec(s); return (m ? m[1] : s).trim(); };
const isMail = s => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);

/** Splits "a@x.com, b@y.com" into a clean list (max 5). Returns { list, bad } */
function parseRecipients(text) {
  const parts = String(text ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  return { list: parts.filter(isMail).slice(0, 5), bad: parts.filter(p => !isMail(p)) };
}

/**
 * Sends one plain-text e-mail.
 * cfg: { host, port, secure: 'ssl' | 'starttls' | 'none', user, pass, from, to: [addr…], subject, text }
 * Resolves when the server accepted the message, rejects with a readable Error otherwise.
 */
function smtpSend(cfg) {
  return new Promise((resolve, reject) => {
    const to = (cfg.to || []).map(addrOnly);
    if (!cfg.host || !cfg.port) return reject(new Error('The mail server (SMTP host and port) is not set.'));
    if (!to.length) return reject(new Error('There is no recipient e-mail address.'));
    const from = clean(cfg.from) || clean(cfg.user);
    if (!isMail(addrOnly(from))) return reject(new Error('The “From” address is not a valid e-mail address.'));

    let sock, buf = '', waiting = null, finished = false, timer, connected = false;
    const end = err => {
      if (finished) return; finished = true; clearTimeout(timer);
      try { sock && sock.destroy(); } catch { /* ignore */ }
      err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve();
    };
    timer = setTimeout(() => end(new Error('The mail server did not answer in time (20 s).')), 20_000);

    // A reply is finished when its last line looks like "250 text" (a space after the code, not a dash).
    const take = () => {
      const lines = buf.split('\r\n');
      if (lines.length < 2) return;
      const last = lines[lines.length - 2];
      if (!/^\d{3}( |$)/.test(last) || !waiting) return;
      const text = lines.slice(0, -1).join('\n'); buf = '';
      const w = waiting; waiting = null; w(text);
    };
    const attach = s => {
      sock = s; s.setEncoding('utf8');
      s.on('data', d => { buf += d; take(); });
      s.on('error', e => end(new Error(connected ? 'Mail connection failed: ' + e.message : 'Could not connect to ' + cfg.host + ':' + cfg.port + ' (' + e.message + ')')));
      s.on('close', () => { if (!finished) end(new Error('The mail server closed the connection.')); });
    };
    const reply = () => new Promise(r => { waiting = r; take(); });
    const send = async (line, ok) => {
      sock.write(line + '\r\n');
      const r = await reply();
      if (!ok.includes(r.slice(0, 3))) throw new Error('Mail server said: ' + r.split('\n').pop().slice(0, 200));
      return r;
    };

    (async () => {
      const opts = { host: cfg.host, port: Number(cfg.port), servername: net.isIP(cfg.host) ? undefined : cfg.host };
      await new Promise((ok, bad) => {
        const s = cfg.secure === 'ssl' ? tls.connect(opts, () => { connected = true; ok(); }) : net.connect(opts, () => { connected = true; ok(); });
        attach(s);
      });
      const greet = await reply();
      if (!greet.startsWith('220')) throw new Error('Mail server said: ' + greet.slice(0, 200));
      const me = 'memeforge.local';
      let ehlo = await send('EHLO ' + me, ['250']);
      if (cfg.secure === 'starttls') {
        await send('STARTTLS', ['220']);
        const plain = sock; plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
        await new Promise((ok, bad) => {
          const s = tls.connect({ socket: plain, servername: net.isIP(cfg.host) ? undefined : cfg.host }, ok);
          s.once('error', e => bad(new Error('TLS upgrade failed: ' + e.message)));
          attach(s);
        });
        buf = '';
        ehlo = await send('EHLO ' + me, ['250']);
      }
      if (cfg.user) {
        const token = b64('\u0000' + cfg.user + '\u0000' + (cfg.pass || ''));
        await send('AUTH PLAIN ' + token, ['235']).catch(e => { throw new Error('Login to the mail server failed. Check the user name and password. (' + e.message + ')'); });
      }
      await send('MAIL FROM:<' + addrOnly(from) + '>', ['250']);
      for (const r of to) await send('RCPT TO:<' + r + '>', ['250', '251']);
      await send('DATA', ['354']);
      const head = [
        'From: ' + encHeader(clean(cfg.fromName || '')) + (cfg.fromName ? ' <' + addrOnly(from) + '>' : addrOnly(from)),
        'To: ' + to.join(', '),
        'Subject: ' + encHeader(clean(cfg.subject)),
        'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
        'Message-ID: <' + Date.now().toString(36) + Math.random().toString(36).slice(2) + '@memeforge.local>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
      ].join('\r\n');
      const body = wrap76(b64(String(cfg.text ?? '')));
      await send(head + '\r\n\r\n' + body + '\r\n.', ['250']);
      try { sock.write('QUIT\r\n'); } catch { /* ignore */ }
      end();
    })().catch(end);
  });
}

/**
 * Sends one plain-text e-mail through Resend's HTTPS API (port 443, so it works where outbound SMTP is blocked).
 * cfg: { apiKey, from, to: [addr…], subject, text, url?, fetchImpl?, timeoutMs? }
 * Resolves when Resend accepted the message, rejects with a readable Error otherwise.
 */
async function resendSend(cfg) {
  const to = (cfg.to || []).map(addrOnly).filter(Boolean);
  if (!cfg.apiKey) throw new Error('The Resend API key is not set.');
  const from = clean(cfg.from);
  if (!from) throw new Error('The “From” address is not set.');
  if (!to.length) throw new Error('There is no recipient e-mail address.');
  let res;
  try {
    res = await (cfg.fetchImpl || fetch)(cfg.url || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: clean(cfg.subject), text: String(cfg.text ?? '') }),
      signal: AbortSignal.timeout(cfg.timeoutMs || 15000),
    });
  } catch (e) {
    throw new Error('Could not reach Resend (' + (e && e.name === 'TimeoutError' ? 'it took too long' : (e && e.message) || 'network error') + ').');
  }
  if (res.ok) return;
  let said = '';
  try { const j = JSON.parse(await res.text()); said = String(j.message || (j.error && j.error.message) || '').slice(0, 250); } catch { /* not JSON */ }
  if (res.status === 401) throw new Error('Resend did not accept the API key. Check that you pasted the whole key (it starts with re_).');
  throw new Error('Resend refused the e-mail' + (said ? ': ' + said : ' (HTTP ' + res.status + ').'));
}

/* ---------- SOL price (USD + PHP) ---------- */
let priceCache = { at: 0, usd: 0, php: 0 };
async function getSolPrice(fetchImpl = fetch) {
  const age = Date.now() - priceCache.at;
  if (priceCache.usd && age < 5 * 60_000) return { usd: priceCache.usd, php: priceCache.php, at: priceCache.at };
  try {
    const r = await fetchImpl('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd,php', { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const usd = Number(j?.solana?.usd), php = Number(j?.solana?.php);
    if (!(usd > 0) || !(php > 0)) throw new Error('bad price data');
    priceCache = { at: Date.now(), usd, php };
    return { usd, php, at: priceCache.at };
  } catch {
    if (priceCache.usd && age < 6 * 3_600_000) return { usd: priceCache.usd, php: priceCache.php, at: priceCache.at };   // an older price is better than none
    return null;
  }
}
const setPriceCacheForTests = v => { priceCache = v; };

/** "PHP" | "USD" | "BOTH" → text such as "₱1,234.56 PHP" for a SOL amount. Empty price → "price unavailable". */
function convertedText(solAmount, currency, price) {
  if (!price) return 'price unavailable';
  const f = (n, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const php = f(solAmount * price.php, 'PHP'), usd = f(solAmount * price.usd, 'USD');
  return currency === 'USD' ? usd : currency === 'BOTH' ? php + ' / ' + usd : php;
}

/** Fills {name} placeholders. Unknown ones are left as they are so a typo in the admin is easy to spot. */
const render = (tpl, vars) => String(tpl ?? '').replace(/\{([a-z_]+)\}/gi, (m, k) => Object.prototype.hasOwnProperty.call(vars, k.toLowerCase()) ? String(vars[k.toLowerCase()]) : m);

module.exports = { smtpSend, resendSend, getSolPrice, convertedText, render, parseRecipients, isMail, setPriceCacheForTests };
