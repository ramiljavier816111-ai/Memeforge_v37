/* A tiny fake mail server for tests (not a test file itself). */
'use strict';
const net = require('node:net');

// A tiny fake mail server. Returns { port, mails, close }.
function fakeSmtp({ requireAuth = false, rejectRcpt = false } = {}) {
  const mails = [];
  const server = net.createServer(sock => {
    let data = null, buf = '', cur = { from: '', to: [], raw: '', authed: false };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (data !== null) {
          const i = buf.indexOf('\r\n.\r\n'); if (i < 0) { return; }
          cur.raw = buf.slice(0, i); buf = buf.slice(i + 5); data = null; mails.push({ ...cur }); sock.write('250 queued\r\n'); continue;
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN/i.test(line)) {
          const [, user, pass] = Buffer.from(line.slice(11), 'base64').toString().split('\u0000');
          if (user === 'me@x.test' && pass === 'secret') { cur.authed = true; sock.write('235 ok\r\n'); } else sock.write('535 bad credentials\r\n');
        }
        else if (/^MAIL FROM:/i.test(line)) { if (requireAuth && !cur.authed) sock.write('530 auth required\r\n'); else { cur.from = line.slice(10); sock.write('250 ok\r\n'); } }
        else if (/^RCPT TO:/i.test(line)) { if (rejectRcpt) sock.write('550 no such user\r\n'); else { cur.to.push(line.slice(8)); sock.write('250 ok\r\n'); } }
        else if (/^DATA/i.test(line)) { data = ''; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.end('221 bye\r\n'); }
        else sock.write('500 ?\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, mails, close: () => server.close() })));
}
const bodyOf = raw => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
module.exports = { fakeSmtp, bodyOf };
