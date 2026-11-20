/* End-to-end tests for server.js: payment verification, admin login, logo upload, database manager.
   Solana's RPC is faked, so no internet is needed.   Run:  npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');       // must be set BEFORE server.js is loaded
const { server, db, rateBuckets } = require('../server.js');

const WALLET = 'JLqXStBQFBRQnKfnGrGDFuBX8uKDJeZCGhLUqqttg3m';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rnd = n => Array.from(crypto.randomBytes(n), b => B58[b % 58]).join('');
// a REAL-looking Solana address: 32 random bytes, base58 encoded
const rndAddr = () => { let n = BigInt('0x' + crypto.randomBytes(32).toString('hex')) | (1n << 255n), out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } return out; };
const day = off => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - off * 86_400_000));

let base, cookie = '';
const realFetch = global.fetch;
let rpcTx = null;                                       // what the fake Solana RPC returns
global.fetch = (url, opts) => String(url).startsWith('http://127.0.0.1')
  ? realFetch(url, opts)
  : Promise.resolve({ json: async () => ({ jsonrpc: '2.0', id: 1, result: rpcTx }) });

async function call(method, p, body, extra = {}) {
  const r = await realFetch(base + p, {
    method, redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, json, buf, headers: r.headers };
}

test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  db.prepare("UPDATE settings SET value = 'https://rpc.fake' WHERE key = 'rpc_url_devnet'").run();
  db.prepare("UPDATE settings SET value = 'devnet' WHERE key = 'network'").run();
  db.prepare("UPDATE settings SET value = 'devnet' WHERE key = 'site_mode'").run();
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/* ---------------------------------------------------------------- login */
test('admin API is locked until you log in', async () => {
  assert.equal((await call('GET', '/api/admin/settings')).status, 401);
  assert.equal((await call('GET', '/api/admin/db')).status, 401);
  assert.equal((await call('POST', '/api/admin/logo', { image: 'x' })).status, 401);
});
test('wrong password is refused, the default one works and is flagged', async () => {
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  const r = await call('POST', '/api/admin/login', { password: '12345' });
  assert.equal(r.status, 200);
  assert.equal(r.json.passwordIsDefault, true);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/me')).json.loggedIn, true);
});

/* ---------------------------------------------------------------- payments (server side) */
const b58 = buf => {                                    // tiny base58 encoder, only for building the fake transaction
  let n = BigInt('0x' + (buf.toString('hex') || '0')), out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of buf) { if (byte === 0) out = '1' + out; else break; }
  return out;
};
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = s => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
// payerPaid = lamports the creator's wallet lost (rent + network fee + the fee sent to the fee wallet)
function fakeTx({ creator = rndAddr(), mint, feeDelta = 690_872_400, err = null, age = 10, programs = [TOKEN_PROGRAM, METADATA_PROGRAM], feeAsCreator = false,
                  payerPaid = 700_000_000, name = 'Doge Moon', symbol = 'DMOON' }) {
  const payer = feeAsCreator ? WALLET : creator;
  const keys = feeAsCreator ? [WALLET, mint, ...programs] : [payer, mint, ...programs, WALLET];
  const pre = keys.map(() => 1_000_000_000), post = [...pre];
  const wi = keys.indexOf(WALLET);
  post[wi] = pre[wi] + (feeAsCreator ? -50_000 : feeDelta);
  if (!feeAsCreator) post[0] = pre[0] - payerPaid;
  const mi = keys.indexOf(METADATA_PROGRAM);
  const instructions = mi < 0 ? [] : [{ programIdIndex: mi, accounts: [], data: b58(Buffer.concat([Buffer.from([33]), str(name), str(symbol), str('https://x.test/m.json')])) }];
  return { blockTime: Math.floor(Date.now() / 1000) - age, meta: { err, fee: 5000, preBalances: pre, postBalances: post }, transaction: { message: { accountKeys: keys, instructions } } };
}
// A PAID order put straight into the database (for tests that are about something else than paying).
function insertPaidOrder(wallet = rndAddr(), amount = 290_872_400) {
  const id = crypto.randomBytes(8).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  db.prepare("INSERT INTO orders(id, secret_hash, network, wallet, amount_lamports, status, paid_lamports, revenue_lamports, day, created_ms) VALUES (?,?,?,?,?,'paid',?,?,?,?)")
    .run(id, crypto.createHash('sha256').update(secret).digest('hex'), 'devnet', wallet, amount, amount, amount, day(0), Date.now());
  return { order: id, secret, wallet };
}
// The transaction a visitor sends to pay: creator → revenue wallet transfer + a memo carrying the order id.
const SYSTEM = '11111111111111111111111111111111', MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
function payTx({ order, creator, lamports, memo = order, to = WALLET, gain = lamports, skipMemo = false }) {
  const keys = [creator, to, SYSTEM, MEMO], pre = keys.map(() => 5_000_000_000), post = [...pre];
  post[0] -= lamports + 5000; post[1] += gain;
  const data = Buffer.alloc(12); data.writeUInt32LE(2, 0); data.writeBigUInt64LE(BigInt(lamports), 4);
  const instructions = [{ programIdIndex: 2, accounts: [0, 1], data: b58(data) }];
  if (!skipMemo) instructions.push({ programIdIndex: 3, accounts: [], data: b58(Buffer.from(memo)) });
  return { blockTime: Math.floor(Date.now() / 1000) - 5, meta: { err: null, fee: 5000, preBalances: pre, postBalances: post }, transaction: { message: { accountKeys: keys, instructions } } };
}
async function report(net = 'devnet') { return (await call('GET', `/api/admin/stats?days=7&network=${net}`)).json; }

test('fees-config.js is generated from the database (what the public pages read)', async () => {
  const r = await call('GET', '/fees-config.js');
  assert.match(r.buf.toString(), /^window\.MEMEFORGE_CONFIG = \{/);
  const cfg = JSON.parse(r.buf.toString().replace(/^window\.MEMEFORGE_CONFIG = /, '').replace(/;$/, ''));
  assert.equal(cfg.feeWallet, WALLET);
  assert.equal(cfg.creationFee, 0.1);
  assert.deepEqual(cfg.featureFees, { banner: 0.1, social: 0.1, creator: 0.1, mintRevoke: 0.1, freezeRevoke: 0.1, metaRevoke: 0.1 });   // every price starts at 0.1 SOL
});

test('a real token creation is recorded with the revenue the fee wallet actually received', async () => {
  const mint = rndAddr(), signature = rnd(88);
  rpcTx = fakeTx({ mint });
  const r = await call('POST', '/api/token-created', { signature, mint });
  assert.equal(r.status, 200);
  assert.equal(r.json.revenue, 0.6908724);
  const s = await report();
  assert.equal(s.today.tokens, 1);
  assert.equal(s.today.revenue_lamports, 690_872_400);
  assert.equal(s.lifetime.devnet.tokens, 1);
  assert.equal(s.lifetime['mainnet-beta'].tokens, 0);   // devnet and mainnet never mix

  const again = await call('POST', '/api/token-created', { signature, mint });   // same signature again
  assert.equal(again.json.duplicate, true);
  assert.equal((await report()).today.tokens, 1);       // not counted twice
});

test('fake or unrelated transactions are rejected and never counted', async () => {
  const mint = rndAddr();
  rpcTx = fakeTx({ mint, programs: [TOKEN_PROGRAM] });                                     // no Metaplex = not a token creation
  assert.equal((await call('POST', '/api/token-created', { signature: rnd(88), mint })).status, 400);
  rpcTx = fakeTx({ mint, err: { InstructionError: [0, 'Custom'] } });                       // failed on-chain
  assert.equal((await call('POST', '/api/token-created', { signature: rnd(88), mint })).status, 400);
  rpcTx = fakeTx({ mint, age: 3600 });                                                      // an hour old
  assert.equal((await call('POST', '/api/token-created', { signature: rnd(88), mint })).status, 400);
  assert.equal((await call('POST', '/api/token-created', { signature: 'bad', mint: 'bad' })).status, 400);
  assert.equal((await report()).today.tokens, 1);                                           // still just the one real token
});

test('revenue is 0 (not negative) when the creator IS the fee wallet, e.g. you testing', async () => {
  const mint = rndAddr();
  rpcTx = fakeTx({ mint, feeAsCreator: true });
  const r = await call('POST', '/api/token-created', { signature: rnd(88), mint });
  assert.equal(r.json.revenue, 0);
  const s = await report();
  assert.equal(s.today.tokens, 2);
  assert.equal(s.today.revenue_lamports, 690_872_400);
});

/* ---------------------------------------------------------------- spent / fee / network + token names */
test('each token records what the creator spent, what went to MemeForge, the network cost and the on-chain name', async () => {
  const mint = rndAddr(), creator = rndAddr(), signature = rnd(88);
  rpcTx = fakeTx({ mint, creator, payerPaid: 700_000_000, name: 'Doge Moon', symbol: 'DMOON' });
  const before = (await report()).today;
  const r = await call('POST', '/api/token-created', { signature, mint, wallet: 'Phantom', features: ['banner', 'mintRevoke', 'bogus'] });
  assert.equal(r.status, 200);
  assert.equal(r.json.paid, 0.7);
  assert.equal(r.json.network, (700_000_000 - 690_872_400) / 1e9);
  const row = db.prepare('SELECT * FROM tokens WHERE signature = ?').get(signature);
  assert.equal(row.creator, creator);
  assert.equal(row.paid_lamports, 700_000_000);
  assert.equal(row.revenue_lamports, 690_872_400);
  assert.equal(row.network_lamports, 9_127_600);
  assert.equal(row.token_name, 'Doge Moon');                    // read from the chain
  assert.equal(row.token_symbol, 'DMOON');
  assert.equal(row.wallet_name, 'Phantom');
  assert.equal(row.features, 'banner,mintRevoke');              // unknown feature names are dropped
  const s = await report();
  assert.equal(s.today.spent_lamports - before.spent_lamports, 700_000_000);
  assert.equal(s.today.network_lamports - before.network_lamports, 9_127_600);
  assert.equal(s.today.revenue_lamports - before.revenue_lamports, 690_872_400);
  assert.ok(s.lifetime.devnet.spent_lamports >= 700_000_000);
});

test('the admin token list shows everything and the creator becomes a known wallet', async () => {
  const t = (await call('GET', '/api/admin/tokens?network=devnet')).json;
  const top = t.rows[0];
  assert.equal(top.token_name, 'Doge Moon');
  assert.equal(top.paid_lamports, 700_000_000);
  assert.equal(top.fee_lamports, 690_872_400);
  const w = (await call('GET', '/api/admin/visitor-wallets?network=devnet')).json;
  const me = w.rows.find(r => r.address === top.creator);
  assert.ok(me, 'creator is listed as a wallet');
  assert.equal(me.tokens, 1); assert.equal(me.paid_lamports, 700_000_000); assert.equal(me.wallet, 'Phantom');
  assert.equal((await call('GET', '/api/admin/tokens?network=devnet&q=' + top.creator.slice(0, 8))).json.total, 1);
  assert.equal((await call('GET', '/api/admin/tokens?network=devnet&q=zzzzzzzz')).json.total, 0);
});

test('wallet connect pings are recorded once per address and validated', async () => {
  const a = rndAddr();
  assert.equal((await call('POST', '/api/wallet-connected', { address: 'not-an-address' })).status, 400);
  // Solana wallets only: Ethereum / Bitcoin style addresses and base58 text that is not 32 bytes are refused
  for (const bad of ['0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'z'.repeat(44), rndAddr() + '1'])
    assert.equal((await call('POST', '/api/wallet-connected', { address: bad })).status, 400, bad);
  assert.equal((await call('POST', '/api/wallet-connected', { address: a, wallet: 'Solflare' })).status, 204);
  assert.equal((await call('POST', '/api/wallet-connected', { address: a, wallet: '' })).status, 204);     // again: counts a connect, keeps the app name
  const row = db.prepare('SELECT * FROM wallets WHERE address = ?').get(a);
  assert.equal(row.connects, 2); assert.equal(row.wallet, 'Solflare');
  const s = await report();
  assert.ok(s.wallets.total >= 2); assert.ok(s.today.wallets >= 2);                                       // new wallets today
});

test('CSV exports defuse spreadsheet formulas in token names', async () => {
  const mint = rndAddr();
  rpcTx = fakeTx({ mint, name: '=HYPERLINK("http://evil","x")', symbol: '+SUM' });
  assert.equal((await call('POST', '/api/token-created', { signature: rnd(88), mint })).status, 200);
  const csv = (await call('GET', '/api/admin/tokens.csv?network=devnet')).buf.toString();
  assert.ok(csv.startsWith('created_utc,day,network,token_name'));
  assert.ok(!/(^|,)=HYPERLINK/.test(csv) && csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), csv);
  assert.ok(csv.includes(",'+SUM,"));
  const w = (await call('GET', '/api/admin/visitor-wallets.csv?network=devnet')).buf.toString();
  assert.ok(w.startsWith('wallet_address,wallet_app'));
  const d = (await call('GET', '/api/admin/report.csv?days=3&network=devnet')).buf.toString();
  assert.ok(d.startsWith('day,network,visitors,new_wallets,tokens_created,total_spent_sol,sent_to_memeforge_sol,network_cost_sol'));
});

/* ---------------------------------------------------------------- wallet list (admin → Wallets) */
const walletCfg = async () => JSON.parse((await call('GET', '/fees-config.js')).buf.toString().replace(/^window\.MEMEFORGE_CONFIG = /, '').replace(/;$/, '')).wallets;

test('wallet list: starts with the 11 top wallets (Phantom, Solflare, Backpack first) and is served to the public page', async () => {
  const cfg = await walletCfg();
  assert.deepEqual(cfg.slice(0, 3).map(w => w.name), ['Phantom', 'Solflare', 'Backpack']);
  assert.equal(cfg.length, 11);
  assert.equal(cfg[0].provider, 'phantom.solana'); assert.equal(cfg[0].flag, 'isPhantom');
  const adm = (await call('GET', '/api/admin/wallet-options')).json;
  assert.equal(adm.wallets.length, 11); assert.ok(adm.presets.length >= 130, 'catalog has 130+ wallets');
  assert.ok(adm.presets.every(p => p.id && p.name && p.cat));
});
test('wallet catalog: add selected / add all, skipping ones already there', async () => {
  const before = (await call('GET', '/api/admin/wallet-options')).json.wallets.length;
  const one = await call('POST', '/api/admin/wallet-options/add-presets', { ids: ['glow', 'phantom'] });   // phantom already exists
  assert.equal(one.status, 200); assert.equal(one.json.added, 1); assert.equal(one.json.wallets.length, before + 1);
  assert.equal((await call('POST', '/api/admin/wallet-options/add-presets', { ids: ['nope'] })).status, 400);
  const all = await call('POST', '/api/admin/wallet-options/add-presets', { ids: 'all' });
  assert.equal(all.json.wallets.length, all.json.presets.length, 'every catalog wallet is now on the list');
  assert.ok(all.json.wallets.length >= 130);
  assert.ok((await walletCfg()).length >= 130, 'visitors get them all (the popup has a search box)');
  // put the list back to the 11 defaults for the next tests
  for (const w of all.json.wallets.slice(11)) await call('DELETE', '/api/admin/wallet-options/' + encodeURIComponent(w.id));
  assert.equal((await walletCfg()).length, 11);
});
test('wallet list: add with a logo link, edit, hide, reorder, delete', async () => {
  const add = await call('POST', '/api/admin/wallet-options', { name: 'Test Wallet', logoUrl: 'https://cdn.example.com/test.png', provider: 'okxwallet.solana', installUrl: 'https://www.okx.com/web3', color: '#222222' });
  assert.equal(add.status, 200);
  const okx = add.json.wallets.find(w => w.name === 'Test Wallet');
  assert.equal(okx.id, 'test-wallet'); assert.equal(okx.logoUrl, 'https://cdn.example.com/test.png'); assert.equal(okx.enabled, true);
  assert.equal((await walletCfg()).find(w => w.id === 'test-wallet').logo, 'https://cdn.example.com/test.png');

  assert.equal((await call('PUT', '/api/admin/wallet-options/test-wallet', { ...okx, name: 'OKX', enabled: false })).status, 200);
  assert.ok(!(await walletCfg()).some(w => w.id === 'test-wallet'), 'hidden wallets are not sent to the public page');

  const ids = (await call('GET', '/api/admin/wallet-options')).json.wallets.map(w => w.id);
  const reordered = ['test-wallet', ...ids.filter(i => i !== 'test-wallet')];
  assert.deepEqual((await call('POST', '/api/admin/wallet-options/reorder', { ids: reordered })).json.wallets.map(w => w.id), reordered);
  assert.equal((await call('POST', '/api/admin/wallet-options/reorder', { ids: ['phantom'] })).status, 400);

  assert.equal((await call('DELETE', '/api/admin/wallet-options/test-wallet')).status, 200);
  assert.equal((await call('DELETE', '/api/admin/wallet-options/test-wallet')).status, 404);
  assert.ok(!(await walletCfg()).some(w => w.id === 'test-wallet'));
});
test('wallet list: unsafe or malformed input is refused', async () => {
  const bad = b => call('POST', '/api/admin/wallet-options', { name: 'X', ...b });
  assert.equal((await bad({ name: '' })).status, 400);
  assert.equal((await bad({ logoUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await bad({ logoUrl: 'http://insecure.example/x.png' })).status, 400);
  assert.equal((await bad({ logoUrl: 'https://a.example/x y.png' })).status, 400);
  assert.equal((await bad({ installUrl: 'data:text/html,hi' })).status, 400);
  assert.equal((await bad({ provider: 'window.__proto__.x' })).status, 400);
  assert.equal((await bad({ provider: 'a.constructor' })).status, 400);
  assert.equal((await bad({ provider: 'alert(1)' })).status, 400);
  assert.equal((await bad({ flag: 'is Bad' })).status, 400);
  assert.equal((await bad({ deeplink: 'https://w.example/open?x=1' })).status, 400);       // must contain {url}
  assert.equal((await bad({ color: 'red' })).status, 400);
  assert.equal((await call('POST', '/api/admin/wallet-options', { name: 'Ok', deeplink: 'https://w.example/open?u={url}', provider: 'ok.solana' })).status, 200);
  assert.equal((await call('GET', '/api/admin/wallet-options')).json.wallets.at(-1).id, 'ok');
  await call('DELETE', '/api/admin/wallet-options/ok');
});
test('wallet list: the admin API is locked and logo links are allowed by the admin page policy', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/wallet-options')).status, 401);
  assert.equal((await call('POST', '/api/wallet-connected', { address: rndAddr() })).status, 204);   // the public ping needs no login
  cookie = saved;
  const r = await realFetch(base + '/admin');
  assert.match(r.headers.get('content-security-policy'), /img-src [^;]*https:/);
});

/* ---------------------------------------------------------------- logo */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

test('no logo yet -> /logo is 404 (the page then shows the default rocket)', async () => {
  assert.equal((await call('GET', '/logo')).status, 404);
});
test('logo upload: a real PNG is stored and served with caching headers', async () => {
  const up = await call('POST', '/api/admin/logo', { image: dataUrl(PNG) });
  assert.equal(up.status, 200); assert.equal(up.json.mime, 'image/png');
  const g = await call('GET', '/logo');
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.deepEqual(g.buf, PNG);
  const etag = g.headers.get('etag');
  assert.equal((await call('GET', '/logo', undefined, { 'if-none-match': etag })).status, 304);
});
test('logo upload: SVG, fake images and oversized files are refused', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await call('POST', '/api/admin/logo', { image: dataUrl(svg, 'image/svg+xml') })).status, 400);
  assert.equal((await call('POST', '/api/admin/logo', { image: dataUrl(Buffer.from('<html>not an image</html>'), 'image/png') })).status, 400);   // lies about its type
  assert.equal((await call('POST', '/api/admin/logo', { image: 'hello' })).status, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
  assert.equal((await call('POST', '/api/admin/logo', { image: dataUrl(big) })).status, 413);
  assert.deepEqual((await call('GET', '/logo')).buf, PNG);     // the good logo is untouched
});
test('logo can be removed', async () => {
  assert.equal((await call('DELETE', '/api/admin/logo')).status, 200);
  assert.equal((await call('GET', '/logo')).status, 404);
});

/* ---------------------------------------------------------------- database manager */
test('database overview: size, limit, status and every table', async () => {
  const o = (await call('GET', '/api/admin/db')).json;
  assert.ok(o.total > 0);
  assert.equal(o.limitMb, 100);
  assert.equal(o.status, 'ok');
  assert.deepEqual(o.tables.map(t => t.name), ['visits', 'tokens', 'orders', 'wallets', 'daily_stats', 'daily_visitors', 'wallet_options', 'fees', 'settings']);
  assert.equal(o.tables.find(t => t.name === 'tokens').rows, db.prepare('SELECT COUNT(*) c FROM tokens').get().c);
  assert.equal(o.tables.find(t => t.name === 'settings').deletable, false);
});
test('browsing hides the admin password hash and rejects unknown tables', async () => {
  const s = (await call('GET', '/api/admin/db/table?name=settings')).json;
  const row = s.rows.find(r => r.key === 'admin_pass_hash');
  assert.ok(row); assert.equal(row.value, '••••••••');
  assert.equal((await call('GET', '/api/admin/db/table?name=sqlite_master')).status, 400);
  assert.equal((await call('GET', '/api/admin/db/table?name=visits";DROP TABLE fees;--')).status, 400);
});
test('limit setting is validated; a full database reports "warn" / "over"', async () => {
  assert.equal((await call('PUT', '/api/admin/db/limit', { limitMb: 0 })).status, 400);
  assert.equal((await call('PUT', '/api/admin/db/limit', { limitMb: 'x' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/db/limit', { limitMb: 1 })).json.limitMb, 1);
  const ins = db.prepare('INSERT OR IGNORE INTO visits(day, visitor) VALUES (?, ?)');
  db.exec('BEGIN'); for (let i = 0; i < 40_000; i++) ins.run('2019-01-01', crypto.randomBytes(16).toString('hex')); db.exec('COMMIT');
  const o = (await call('GET', '/api/admin/db')).json;
  assert.ok(['warn', 'over'].includes(o.status), 'status was ' + o.status + ' at ' + o.percent + '%');
});

test('deleting old visits keeps the report history (visitor totals are rolled up first) and never touches today', async () => {
  const ins = db.prepare('INSERT OR IGNORE INTO visits(day, visitor) VALUES (?, ?)');
  const old = day(40), today = day(0);
  for (let i = 0; i < 7; i++) ins.run(old, 'old' + i);
  for (let i = 0; i < 3; i++) ins.run(today, 'today' + i);
  const before = await call('GET', '/api/admin/stats?days=90&network=devnet');
  const oldBefore = before.json.rows.find(r => r.day === old).visitors;
  assert.equal(oldBefore, 7);

  const dry = await call('POST', '/api/admin/db/delete', { table: 'visits', mode: 'older', days: 30, dryRun: true });
  assert.equal(dry.json.count, 40_000 + 7);                 // shows the exact number before you confirm
  assert.equal(db.prepare('SELECT COUNT(*) c FROM visits').get().c, 40_010);   // dry run deleted nothing

  const del = await call('POST', '/api/admin/db/delete', { table: 'visits', mode: 'older', days: 30, optimize: true });
  assert.equal(del.json.deleted, 40_007);
  assert.ok(del.json.shrink.after < del.json.shrink.before, 'optimize should shrink the file');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM visits').get().c, 3);         // only today's rows are left

  const after = await call('GET', '/api/admin/stats?days=90&network=devnet');
  assert.equal(after.json.rows.find(r => r.day === old).visitors, 7);           // history survived the purge
  assert.equal(after.json.rows.find(r => r.day === today).visitors, 3 + 0);     // today untouched, not double counted
});

test('safety rules: protected tables, bad input and per-row rules', async () => {
  const del = b => call('POST', '/api/admin/db/delete', b);
  assert.equal((await del({ table: 'settings', mode: 'older', days: 0 })).status, 403);
  assert.equal((await del({ table: 'fees', mode: 'ids', ids: [1] })).status, 403);
  assert.equal((await del({ table: 'sqlite_master', mode: 'older', days: 0 })).status, 403);
  assert.equal((await del({ table: 'visits', mode: 'ids', ids: [1] })).status, 400);       // visits: by age only
  assert.equal((await del({ table: 'visits', mode: 'older', days: -1 })).status, 400);
  assert.equal((await del({ table: 'visits', mode: 'older', days: '1; DROP TABLE x' })).status, 400);
  assert.equal((await del({ table: 'tokens', mode: 'ids', ids: ['1 OR 1=1'] })).status, 400);
  assert.equal((await del({ table: 'tokens', mode: 'ids', ids: [] })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fees').get().c, 7);
});

test('visitor wallets can be removed by selection only (not by age); wallet_options are protected here', async () => {
  const del = b => call('POST', '/api/admin/db/delete', b);
  assert.equal((await del({ table: 'wallets', mode: 'older', days: 0 })).status, 400);
  assert.equal((await del({ table: 'wallet_options', mode: 'ids', ids: [1] })).status, 403);
  const list = (await call('GET', '/api/admin/db/table?name=wallets')).json;
  assert.equal(list.byIds, true); assert.equal(list.byAge, false);
  const before = db.prepare('SELECT COUNT(*) c FROM wallets').get().c;
  assert.equal((await del({ table: 'wallets', mode: 'ids', ids: [list.rows[0]._id] })).json.deleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM wallets').get().c, before - 1);
});

test('deleting selected tokens removes only those rows and leaves report revenue alone', async () => {
  const list = (await call('GET', '/api/admin/db/table?name=tokens')).json;
  assert.equal(list.byIds, true);
  const id = list.rows[0]._id;
  const count = () => db.prepare('SELECT COUNT(*) c FROM tokens').get().c;
  const n = count(), revenue = (await report()).today.revenue_lamports;
  const r = await call('POST', '/api/admin/db/delete', { table: 'tokens', mode: 'ids', ids: [id] });
  assert.equal(r.json.deleted, 1);
  assert.equal(count(), n - 1);
  assert.equal((await report()).today.revenue_lamports, revenue);          // revenue report unchanged
});

test('backup downloads a real, openable SQLite file', async () => {
  const b = await call('GET', '/api/admin/db/backup');
  assert.equal(b.status, 200);
  assert.match(b.headers.get('content-disposition'), /memeforge-backup-\d{4}-\d{2}-\d{2}\.db/);
  assert.equal(b.buf.subarray(0, 15).toString('latin1'), 'SQLite format 3');
  const f = path.join(tmp, 'restored.db'); fs.writeFileSync(f, b.buf);
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync(f);
  assert.equal(copy.prepare('SELECT COUNT(*) c FROM tokens').get().c, db.prepare('SELECT COUNT(*) c FROM tokens').get().c);
  copy.close();
});

test('password change works and clears the "default password" warning', async () => {
  assert.equal((await call('POST', '/api/admin/password', { current: 'wrong', next: 'abcdef' })).status, 403);
  assert.equal((await call('POST', '/api/admin/password', { current: '12345', next: 'abc' })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { current: '12345', next: 'abcdef' })).status, 200);
  assert.equal((await call('GET', '/api/admin/settings')).json.passwordIsDefault, false);
});

test('daily report: 7-day pages, Previous/Next via offset, and the live overview endpoint', async () => {
  const cur = (await call('GET', '/api/admin/stats?network=devnet')).json;           // default = 7 days
  assert.equal(cur.rows.length, 7); assert.equal(cur.offset, 0); assert.equal(cur.hasNewer, false);
  const prev = (await call('GET', '/api/admin/stats?days=7&offset=7&network=devnet')).json;
  assert.equal(prev.rows.length, 7); assert.equal(prev.hasNewer, true);
  assert.equal(prev.rows[0].day, day(7)); assert.equal(prev.rows[6].day, day(13));
  assert.equal(prev.today.day, day(0), 'today stays today when paging back');
  assert.equal(cur.rows[6].day, day(6));
  assert.equal((await call('GET', '/api/admin/report.csv?days=7&offset=7&network=devnet')).buf.toString().split('\n')[1].split(',')[0], day(13));
  const live = (await call('GET', '/api/admin/live?network=devnet')).json;
  assert.equal(live.today.day, day(0)); assert.ok(live.db.limitMb > 0); assert.ok(Array.isArray(live.tokens) && live.tokens.length <= 10);
  assert.ok(live.lifetime.devnet && live.wallets.total >= 0);
  assert.equal((await new Promise(r => { const rq = require('node:http').get(base + '/api/admin/live', x => r(x.statusCode)); })).valueOf(), 401);
});

test('RPC endpoint and revenue wallet are separate for mainnet and devnet', async () => {
  const s0 = (await call('GET', '/api/admin/settings')).json;
  assert.equal(s0.network, 'devnet'); assert.equal(s0.rpcUrls.devnet, 'https://rpc.fake'); assert.equal(s0.rpcUrls['mainnet-beta'], '');
  assert.equal(s0.feeWallets.devnet, WALLET); assert.equal(s0.feeWallets['mainnet-beta'], WALLET);
  const MAIN = 'So11111111111111111111111111111111111111112';
  const save = body => call('PUT', '/api/admin/settings', { timezone: s0.timezone, fees: {}, ...body });
  const setMode = mode => call('PUT', '/api/admin/mode', { mode });
  assert.equal((await save({ feeWallets: { 'mainnet-beta': 'nope', devnet: WALLET } })).status, 400);
  assert.equal((await save({ rpcUrls: { 'mainnet-beta': 'ftp://x', devnet: '' } })).status, 400);
  assert.equal((await save({ rpcUrls: { 'mainnet-beta': 'https://main.rpc', devnet: 'https://dev.rpc' }, feeWallets: { 'mainnet-beta': MAIN, devnet: WALLET } })).status, 200);
  const s1 = (await call('GET', '/api/admin/settings')).json;
  assert.deepEqual(s1.rpcUrls, { 'mainnet-beta': 'https://main.rpc', devnet: 'https://dev.rpc' });
  assert.deepEqual(s1.feeWallets, { 'mainnet-beta': MAIN, devnet: WALLET });
  const pub = async () => JSON.parse((await call('GET', '/fees-config.js')).buf.toString().replace(/^window\.MEMEFORGE_CONFIG = /, '').replace(/;$/, ''));
  let cfg = await pub(); assert.equal(cfg.rpcUrl, 'https://dev.rpc'); assert.equal(cfg.feeWallet, WALLET);   // devnet is active
  // Pricing & network only edits: a "network" sent with the save is ignored, the switch lives in Site mode
  assert.equal((await save({ network: 'mainnet-beta' })).status, 200);
  assert.equal((await call('GET', '/api/admin/settings')).json.network, 'devnet');
  assert.equal((await setMode('mainnet')).status, 200);
  cfg = await pub(); assert.equal(cfg.rpcUrl, 'https://main.rpc'); assert.equal(cfg.feeWallet, MAIN);       // switching network switches both
  // restore for the other tests
  assert.equal((await setMode('devnet')).status, 200);
  assert.equal((await save({ rpcUrls: { 'mainnet-beta': '', devnet: 'https://rpc.fake' }, feeWallets: { 'mainnet-beta': WALLET, devnet: WALLET } })).status, 200);
});

test('every wallet gets its original logo link, and "fill missing logos" only touches empty ones', async () => {
  const list = (await call('GET', '/api/admin/wallet-options')).json;
  assert.ok(list.wallets.length > 0);
  assert.ok(list.wallets.every(w => /^https:\/\//.test(w.logoUrl)), 'seeded wallets have a logo link');
  assert.ok(list.presets.every(p => /^https:\/\//.test(p.logoUrl)), 'every catalog wallet has a logo link');
  const w = list.wallets[0];
  await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(w.id), { ...w, logoUrl: '' });
  const keep = list.wallets[1];
  await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(keep.id), { ...keep, logoUrl: 'https://example.com/mine.png' });
  const r = (await call('POST', '/api/admin/wallet-options/fill-logos', {})).json;
  assert.equal(r.filled, 1);
  assert.equal(r.wallets.find(x => x.id === w.id).logoUrl, list.wallets[0].logoUrl);
  assert.equal(r.wallets.find(x => x.id === keep.id).logoUrl, 'https://example.com/mine.png');
});

/* ---------------------------------------------------------------- popular wallets */
test('wallets: only Phantom and Solflare start with the Popular badge, and the admin can change any wallet', async () => {
  const list = (await call('GET', '/api/admin/wallet-options')).json.wallets;
  const pop = list.filter(w => w.popular).map(w => w.id).sort();
  assert.deepEqual(pop, ['phantom', 'solflare'], 'only Phantom and Solflare are Popular by default');
  assert.deepEqual((await walletCfg()).filter(w => w.popular).map(w => w.id).sort(), ['phantom', 'solflare'], 'the public page is told the same');

  // the admin can give any other wallet the badge, and take it away again
  const other = list.find(w => !w.popular);
  const on = await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(other.id), { ...other, popular: true });
  assert.equal(on.json.wallets.find(x => x.id === other.id).popular, true);
  assert.equal((await walletCfg()).find(x => x.id === other.id).popular, true);
  await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(other.id), { ...other, popular: false });

  const w = list.find(x => x.id === 'phantom');
  const off = await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(w.id), { ...w, popular: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.wallets.find(x => x.id === w.id).popular, false);
  assert.equal((await walletCfg()).find(x => x.id === w.id).popular, false);

  // an update that does not mention `popular` (e.g. an old client toggling visibility) keeps the badge as it was
  const sf = list.find(x => x.id === 'solflare');
  const { popular, ...noPop } = sf;
  const keep = await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(sf.id), { ...noPop, enabled: false });
  assert.equal(keep.json.wallets.find(x => x.id === sf.id).popular, true);
  await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(sf.id), { ...sf, enabled: true });

  // a new custom wallet can be created as Popular; catalog wallets (other than Phantom/Solflare) arrive without the badge
  const add = await call('POST', '/api/admin/wallet-options', { name: 'My Popular Wallet', popular: true });
  assert.equal(add.json.wallets.find(x => x.id === 'my-popular-wallet').popular, true);
  const plain = await call('POST', '/api/admin/wallet-options', { name: 'My Plain Wallet' });
  assert.equal(plain.json.wallets.find(x => x.id === 'my-plain-wallet').popular, false);
  const cat = (await call('POST', '/api/admin/wallet-options/add-presets', { ids: ['bitget-wallet', 'glow'] })).json.wallets;
  assert.equal(cat.find(x => x.id === 'bitget-wallet').popular, false);    // only Phantom + Solflare are Popular by default
  assert.equal(cat.find(x => x.id === 'glow').popular, false);             // catalog category "Solana"
  for (const id of ['my-popular-wallet', 'my-plain-wallet', 'bitget-wallet', 'glow']) await call('DELETE', '/api/admin/wallet-options/' + id);
  await call('PUT', '/api/admin/wallet-options/' + encodeURIComponent(w.id), { ...w, popular: true });
});

/* ---------------------------------------------------------------- prices */
test('every price starts at 0.1 SOL in the admin too, and the admin can still change them', async () => {
  const s = (await call('GET', '/api/admin/settings')).json;
  assert.equal(s.fees.length, 7);
  assert.ok(s.fees.every(f => f.amount === 0.1), JSON.stringify(s.fees));
  const set = await call('PUT', '/api/admin/settings', { ...s, fees: { creation: 0.05, banner: 0 } });
  assert.equal(set.status, 200);
  const after = (await call('GET', '/api/admin/settings')).json.fees;
  assert.equal(after.find(f => f.key === 'creation').amount, 0.05);
  assert.equal(after.find(f => f.key === 'banner').amount, 0);
  const back = await call('PUT', '/api/admin/settings', { ...s, fees: Object.fromEntries(s.fees.map(f => [f.key, 0.1])) });   // restore
  assert.equal(back.status, 200);
});

/* ---------------------------------------------------------------- appearance */
test('appearance: theme is saved per admin, validated, and locked behind login', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/theme')).status, 401);
  assert.equal((await call('PUT', '/api/admin/theme', { mode: 'light' })).status, 401);
  cookie = saved;

  assert.deepEqual((await call('GET', '/api/admin/theme')).json, { theme: {} });          // nothing saved yet = defaults in the browser
  const theme = { preset: 'custom', mode: 'light', accent: '#10B981', accent2: '#84cc16', gradient: false, bg: 'dots', card: 'solid', blur: false,
    font: 'serif', fontSize: 'large', radius: 'pill', density: 'compact', sidebar: 'accent', navStyle: 'pill', collapsed: true, width: 'wide',
    animations: false, zebra: true, brandName: 'My Launchpad', brandTag: '' };
  const put = await call('PUT', '/api/admin/theme', theme);
  assert.equal(put.status, 200);
  assert.equal(put.json.theme.accent, '#10b981');                                          // colours are stored lower-case
  assert.deepEqual((await call('GET', '/api/admin/theme')).json.theme, put.json.theme);

  // anything outside the fixed lists is refused
  for (const bad of [{ mode: 'neon' }, { accent: 'red' }, { accent: '#12345' }, { gradient: 'yes' }, { nope: 1 }, { radius: '999px' }, { font: 'Comic Sans' }, [], 'x', null])
    assert.equal((await call('PUT', '/api/admin/theme', bad)).status, 400, JSON.stringify(bad));
  // text is cleaned and cut to length; it is only ever shown with textContent
  const long = await call('PUT', '/api/admin/theme', { brandName: '<b>' + 'x'.repeat(80) });
  assert.equal(long.json.theme.brandName.length, 30);
  assert.deepEqual((await call('GET', '/api/admin/theme')).json.theme, long.json.theme);   // a failed save never changed what was stored

  assert.deepEqual((await call('DELETE', '/api/admin/theme')).json, { theme: {} });
});

test('admin page: loads the theme script from its own origin (the page policy blocks inline scripts) and has the new pages', async () => {
  const page = await call('GET', '/admin');
  const html = page.buf.toString();
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/);
  assert.match(html, /<script src="admin-theme\.js"><\/script>/);
  assert.match(html, /data-page="appearance"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline <script> in admin.html');
  const js = await call('GET', '/admin-theme.js');
  assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
});

/* ---------------------------------------------------------------- themes & special offers */
const promoApi = require('../server.js').promo;
const cfgOf = async () => { const r = await call('GET', '/fees-config.js'); return JSON.parse(r.buf.toString().replace(/^window\.MEMEFORGE_CONFIG = /, '').replace(/;$/, '')); };
const manilaLocal = ms => {                                                          // "2026-11-10T14:05" as the clock in Manila shows it
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const PUT = body => call('PUT', '/api/admin/promo', body);

test('themes & offers: locked behind login, and off by default (the public config carries no theme and no offer)', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/promo')).status, 401);
  assert.equal((await call('PUT', '/api/admin/promo', {})).status, 401);
  cookie = saved;
  const cfg = await cfgOf();
  assert.deepEqual(cfg.promo, { theme: null, offer: null });
  assert.equal(cfg.creationFee, 0.1);
});

test('special offer: a live discount lowers the prices the pages show and charge, with the old prices alongside; admin prices stay put', async () => {
  const now = Date.now();
  const r = await PUT({ offer: { on: true, title: 'Xmas sale', discount: 50, applies: 'all', start: manilaLocal(now - 3_600_000), end: manilaLocal(now + 86_400_000) } });
  assert.equal(r.status, 200); assert.equal(r.json.status.offer, 'live');
  const cfg = await cfgOf();
  assert.equal(cfg.creationFee, 0.05);
  assert.equal(cfg.featureFees.banner, 0.05);
  assert.equal(cfg.promo.offer.title, 'Xmas sale');
  assert.equal(cfg.promo.offer.original.creationFee, 0.1);
  assert.equal(cfg.promo.offer.original.featureFees.mintRevoke, 0.1);
  assert.ok(cfg.promo.offer.endsAt > now);
  const settings = (await call('GET', '/api/admin/settings')).json;           // the real prices are untouched
  assert.ok(settings.fees.every(f => f.amount === 0.1), JSON.stringify(settings.fees));
  // "applies to" can be limited
  await PUT({ offer: { on: true, title: 'Base only', discount: 30, applies: 'base' } });
  let c2 = await cfgOf(); assert.equal(c2.creationFee, 0.07); assert.equal(c2.featureFees.social, 0.1);
  await PUT({ offer: { on: true, title: 'Extras only', discount: 30, applies: 'extras' } });
  c2 = await cfgOf(); assert.equal(c2.creationFee, 0.1); assert.equal(c2.featureFees.social, 0.07);
});

test('special offer: not yet started, already ended or switched off means full price; times follow the reports timezone', async () => {
  const now = Date.now();
  await PUT({ offer: { on: true, title: 'Soon', discount: 50, start: manilaLocal(now + 7_200_000), end: manilaLocal(now + 86_400_000) } });
  assert.equal((await call('GET', '/api/admin/promo')).json.status.offer, 'scheduled');
  assert.deepEqual((await cfgOf()).promo.offer, null); assert.equal((await cfgOf()).creationFee, 0.1);
  await PUT({ offer: { on: true, title: 'Old', discount: 50, start: manilaLocal(now - 86_400_000), end: manilaLocal(now - 60_000) } });
  assert.equal((await call('GET', '/api/admin/promo')).json.status.offer, 'ended'); assert.equal((await cfgOf()).creationFee, 0.1);
  await PUT({ offer: { on: false, title: 'Off', discount: 50 } });
  assert.equal((await call('GET', '/api/admin/promo')).json.status.offer, 'off'); assert.equal((await cfgOf()).creationFee, 0.1);
  // Manila is UTC+8 all year: 08:00 there is 00:00 UTC
  assert.equal(promoApi.zonedToMs('2026-01-01T08:00', 'Asia/Manila'), Date.UTC(2026, 0, 1, 0, 0));
  assert.equal(promoApi.zonedToMs('2026-07-01T00:00', 'America/New_York'), Date.UTC(2026, 6, 1, 4, 0));   // daylight saving is handled
  assert.ok(Number.isNaN(promoApi.zonedToMs('2026-02-31T10:00', 'UTC')));
});

test('special offer: a discount can never make a price negative, and prices are rounded to 6 decimals', () => {
  const p = promoApi.priceSet({ creation: 0.01, banner: 0.0333 }, { discount: 90, applies: 'all' });
  assert.equal(p.creation, 0.001); assert.equal(p.banner, 0.00333);
  assert.deepEqual(promoApi.priceSet({ creation: 0.01 }, { discount: 0, applies: 'all' }), { creation: 0.01 });
});

test('themes & offers: bad input is refused and nothing is half-saved', async () => {
  const before = JSON.stringify((await call('GET', '/api/admin/promo')).json.promo);
  const bad = [
    { offer: { discount: 95 } }, { offer: { discount: -1 } }, { offer: { discount: 12.5 } }, { offer: { discount: 'abc' } },
    { offer: { applies: 'everything' } }, { offer: { on: true, title: '' } }, { offer: { on: 'yes' } },
    { offer: { start: 'tomorrow' } }, { offer: { end: '2026-02-31T10:00' } }, { offer: { start: '2030-01-02T10:00', end: '2030-01-01T10:00' } },
    { offer: { ctaUrl: 'javascript:alert(1)' } }, { offer: { ctaUrl: '//evil.example/x' } }, { offer: { ctaUrl: 'http://plain.example' } }, { offer: { ctaUrl: 'data:text/html,hi' } },
    { theme: { mode: 'always' } }, { theme: { active: 'easterbunny' } }, { theme: { schedule: { christmas: { on: true, from: '13-01', to: '12-31' } } } },
    { theme: { schedule: { christmas: { on: true, from: '02-30', to: '03-01' } } } }, { theme: { schedule: { nope: { on: true, from: '01-01', to: '01-02' } } } },
    { theme: { edits: { christmas: { colors: { c1: 'red' } } } } }, { theme: { edits: { christmas: { colors: { c1: '#ff0000;}</style><script>' } } } } },
    { theme: { edits: { christmas: { colors: { nope: '#ff0000' } } } } }, { theme: { edits: { christmas: { effect: 'explode' } } } },
    { theme: { edits: { christmas: { emojis: new Array(15).fill('🎄') } } } }, { theme: { edits: { nope: {} } } }, [], 'x',
  ];
  for (const b of bad) assert.equal((await PUT(b)).status, 400, JSON.stringify(b));
  assert.equal(JSON.stringify((await call('GET', '/api/admin/promo')).json.promo), before);
  // good link forms
  for (const u of ['', 'solana-token-creator.html', '/index.html#how', 'https://example.com/deal']) assert.equal((await PUT({ offer: { ctaUrl: u } })).status, 200, u);
});

test('seasonal theme: manual choice, admin edits on top of a preset, text is cleaned, reset restores the preset', async () => {
  const presets = (await call('GET', '/api/admin/promo')).json.presets;
  for (const id of ['christmas', 'halloween', 'newyear', 'valentine', 'easter', 'summer', 'blackfriday', 'custom']) assert.ok(presets[id], id);
  for (const [id, t] of Object.entries(presets)) {
    for (const v of Object.values(t.colors)) assert.match(v, /^#[0-9a-f]{6}$/i, id);
    assert.ok(t.emojis.length > 0 && t.emojis.length <= 14, id);
  }
  const r = await PUT({ theme: { mode: 'manual', active: 'halloween', edits: { halloween: { colors: { c1: '#112233' }, banner: '<b>Boo</b>\u0000!' + 'x'.repeat(200), emojis: ['🎃', ' ', '👻'] } } } });
  assert.equal(r.status, 200); assert.equal(r.json.status.theme, 'halloween');
  const t = (await cfgOf()).promo.theme;
  assert.equal(t.id, 'halloween'); assert.equal(t.colors.c1, '#112233'); assert.equal(t.colors.c2, presets.halloween.colors.c2);   // only c1 changed
  assert.equal(t.banner.length, 90); assert.ok(!t.banner.includes('\u0000')); assert.deepEqual(t.emojis, ['🎃', '👻']);
  const custom = await PUT({ theme: { mode: 'manual', active: 'custom', edits: { custom: { label: 'Diwali', colors: { bg: '#100000' } } } } });
  assert.equal((await cfgOf()).promo.theme.label, 'Diwali');
  assert.equal((await PUT({ theme: { mode: 'off' } })).json.promo.theme.edits.custom, undefined);   // an unsent edit is dropped, not kept
  assert.equal((await cfgOf()).promo.theme, null);
  assert.equal((await call('DELETE', '/api/admin/promo')).status, 200);
  assert.deepEqual((await cfgOf()).promo, { theme: null, offer: null });
});

test('seasonal theme: automatic mode follows the yearly dates, including a window that wraps over New Year', async () => {
  const P = promoApi.defaultPromo(); P.theme.mode = 'schedule';
  for (const s of Object.values(P.theme.schedule)) s.on = false;
  P.theme.schedule.christmas = { on: true, from: '12-01', to: '12-26' };
  P.theme.schedule.newyear = { on: true, from: '12-27', to: '01-05' };
  const at = (m, d) => promoApi.activeThemeId(P, new Date(Date.UTC(2026, m - 1, d, 4)));      // 04:00 UTC = noon in Manila
  assert.equal(at(12, 10), 'christmas'); assert.equal(at(12, 26), 'christmas');
  assert.equal(at(12, 30), 'newyear'); assert.equal(at(1, 3), 'newyear'); assert.equal(at(1, 5), 'newyear');
  assert.equal(at(1, 6), null); assert.equal(at(6, 15), null);
  P.theme.schedule.summer = { on: true, from: '12-01', to: '12-31' };                          // overlap: the one listed first wins
  assert.equal(at(12, 10), 'christmas');
  P.theme.mode = 'off'; assert.equal(at(12, 10), null);
  // through the real API, with today's date in the reports timezone
  const md = day(0).slice(5), sched = Object.fromEntries(Object.keys(P.theme.schedule).map(id => [id, { on: false, from: '01-01', to: '01-02' }]));
  sched.summer = { on: true, from: md, to: md };
  assert.equal((await PUT({ theme: { mode: 'schedule', schedule: sched } })).json.status.theme, 'summer');
  assert.equal((await cfgOf()).promo.theme.id, 'summer');
  await call('DELETE', '/api/admin/promo');
});

test('themes & offers: the public pages load seasonal.js, and the admin page has the new section', async () => {
  for (const f of ['/', '/solana-token-creator.html']) {
    const html = (await call('GET', f)).buf.toString();
    assert.ok(html.indexOf('fees-config.js') < html.indexOf('seasonal.js'), f + ': seasonal.js must load after fees-config.js');
  }
  const js = await call('GET', '/seasonal.js');
  assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  assert.doesNotMatch(js.buf.toString(), /innerHTML|document\.write|eval\(/, 'seasonal.js never writes markup');
  const admin = (await call('GET', '/admin')).buf.toString();
  assert.match(admin, /data-page="promo"/); assert.match(admin, /id="pmSave"/);
  assert.doesNotMatch(admin, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline <script> in admin.html');
});


/* ---------------------------------------------------------------- site mode: devnet / mainnet / dry run / maintenance */
const modeApi = { get: () => call('GET', '/api/admin/mode'), put: body => call('PUT', '/api/admin/mode', body) };

test('site mode: locked behind login, and an existing install starts in the mode that matches its network', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await modeApi.get()).status, 401);
  assert.equal((await modeApi.put({ mode: 'maintenance' })).status, 401);
  cookie = saved;
  const m = (await modeApi.get()).json;
  assert.equal(m.mode, 'devnet'); assert.equal(m.network, 'devnet');
  assert.equal(m.dryRun.table, true); assert.equal(m.dryRun.network, 'devnet');
  assert.ok(m.maintenance.title && m.maintenance.message, 'there is a friendly default message');
  const cfg = await cfgOf();
  assert.equal(cfg.mode, 'devnet'); assert.equal(cfg.dryRun, null); assert.equal(cfg.maintenance, null);
});

test('site mode: devnet and mainnet switch the network; the settings page no longer does', async () => {
  assert.equal((await modeApi.put({ mode: 'mainnet' })).json.network, 'mainnet-beta');
  let cfg = await cfgOf(); assert.equal(cfg.mode, 'mainnet'); assert.equal(cfg.network, 'mainnet-beta');
  assert.equal((await call('GET', '/api/admin/settings')).json.mode, 'mainnet');
  assert.equal((await call('GET', '/api/admin/live')).json.mode, 'mainnet');
  assert.equal((await modeApi.put({ mode: 'devnet' })).json.network, 'devnet');
  cfg = await cfgOf(); assert.equal(cfg.mode, 'devnet'); assert.equal(cfg.network, 'devnet');
});

test('site mode: dry run uses its own network and the admin can turn its table on or off', async () => {
  let m = (await modeApi.put({ mode: 'dryrun', dryRun: { network: 'mainnet-beta', table: false } })).json;
  assert.equal(m.mode, 'dryrun'); assert.equal(m.network, 'mainnet-beta');
  let cfg = await cfgOf();
  assert.equal(cfg.mode, 'dryrun'); assert.deepEqual(cfg.dryRun, { table: false }); assert.equal(cfg.maintenance, null);
  assert.equal(cfg.network, 'mainnet-beta');
  m = (await modeApi.put({ dryRun: { table: true } })).json;                       // only the table switch changes
  assert.equal(m.mode, 'dryrun'); assert.equal(m.dryRun.network, 'mainnet-beta');
  assert.deepEqual((await cfgOf()).dryRun, { table: true });
  m = (await modeApi.put({ dryRun: { network: 'devnet' } })).json;                 // changing it while a dry run is live moves the network
  assert.equal(m.network, 'devnet');
  assert.equal((await modeApi.put({ mode: 'devnet' })).json.mode, 'devnet');
  assert.equal((await cfgOf()).dryRun, null, 'outside dry run the public page is not told about the table');
});

test('site mode: maintenance keeps the live network and shows a friendly message with a date and time', async () => {
  await modeApi.put({ mode: 'mainnet' });
  const back = Date.now() + 3 * 3_600_000, local = manilaLocal(back);
  const r = await modeApi.put({ mode: 'maintenance', maintenance: { title: 'Back soon', message: 'We are tuning the engines.\nThanks for waiting!', until: local, countdown: true } });
  assert.equal(r.status, 200); assert.equal(r.json.mode, 'maintenance'); assert.equal(r.json.network, 'mainnet-beta', 'maintenance does not change the network');
  const cfg = await cfgOf();
  assert.equal(cfg.mode, 'maintenance'); assert.equal(cfg.dryRun, null);
  assert.equal(cfg.maintenance.title, 'Back soon');
  assert.equal(cfg.maintenance.message, 'We are tuning the engines. Thanks for waiting!', 'line breaks become spaces');
  assert.ok(Math.abs(cfg.maintenance.untilMs - back) < 60_000, 'the time is read in the reports timezone (Manila) and sent as a real instant');
  assert.equal(cfg.maintenance.countdown, true); assert.ok(cfg.maintenance.serverNow > 0);
  // no date = no countdown, but the message is still there
  await modeApi.put({ maintenance: { until: '' } });
  const c2 = await cfgOf(); assert.equal(c2.maintenance.untilMs, null); assert.equal(c2.maintenance.countdown, false);
  await modeApi.put({ mode: 'devnet' });
  assert.equal((await cfgOf()).maintenance, null);
});

test('site mode: bad input is refused and nothing is half-saved', async () => {
  const strip = v => ({ ...v, serverNow: 0 });
  const before = strip((await modeApi.get()).json);
  const bads = [
    { mode: 'nope' }, { mode: 'mainnet-beta' }, { dryRun: { network: 'testnet' } }, { dryRun: { table: 'yes' } },
    { maintenance: { until: '2026-13-40T99:99' } }, { maintenance: { until: 'tomorrow' } }, { maintenance: { title: '   ' } },
    { maintenance: { message: '' } }, { maintenance: { countdown: 'yes' } }, { dryRun: 'x' }, { maintenance: [] },
  ];
  for (const bad of bads) assert.equal((await modeApi.put(bad)).status, 400, JSON.stringify(bad));
  // a valid part next to an invalid part in the same request must not be applied
  assert.equal((await modeApi.put({ mode: 'mainnet', maintenance: { until: 'tomorrow' } })).status, 400);
  assert.deepEqual(strip((await modeApi.get()).json), before, 'a refused save changes nothing');
});

test('site mode: both public pages load site-mode.js after fees-config.js, and the new pages/tabs are wired up', async () => {
  for (const f of ['/', '/solana-token-creator.html']) {
    const html = (await call('GET', f)).buf.toString();
    assert.ok(html.indexOf('fees-config.js') < html.indexOf('site-mode.js') && html.includes('site-mode.js'), f + ': site-mode.js must load after fees-config.js');
  }
  const js = (await call('GET', '/site-mode.js')).buf.toString();
  assert.doesNotMatch(js, /innerHTML|document\.write|eval\(/, 'site-mode.js never writes markup');
  const landing = (await call('GET', '/')).buf.toString();
  assert.match(landing, /id="navConnect"[^>]*>Connect</, 'landing: the top-right button is "Connect"');
  assert.doesNotMatch(landing.slice(landing.indexOf('<nav'), landing.indexOf('</nav>')), /Create token/, 'landing: no "Create token" in the nav');
  const creator = (await call('GET', '/solana-token-creator.html')).buf.toString();
  for (const id of ['id="createBtn">Connect Wallet<', 'id="walletMenu"', 'id="copyAddrSlot"', 'id="txList"', 'id="doneOverlay"', 'id="dryrun"']) assert.ok(creator.includes(id), 'creator has ' + id);
  const admin = (await call('GET', '/admin.html')).buf.toString();
  for (const id of ['data-page="mode"', 'id="modePicks"', 'id="mdDryTable"', 'id="mdUntil"', 'id="mdMessage"']) assert.ok(admin.includes(id), 'admin has ' + id);
  const settingsPage = admin.slice(admin.indexOf('<section class="page" data-page="settings"'), admin.indexOf('<section class="page" data-page="appearance"'));
  assert.ok(settingsPage.length > 500, 'found the Pricing & network page');
  assert.doesNotMatch(settingsPage, /class="netpick"/, 'Pricing & network no longer has the Devnet/Mainnet picker');
});

/* ---------------------------------------------------------------- IPFS hosting (Pinata) */
test('IPFS: key is admin-only, hidden everywhere, and uploads pin images + metadata', async () => {
  assert.equal((await call('POST', '/api/upload-metadata', { metadata: { name: 'A', symbol: 'B' } })).status, 503, 'off until a key is set');
  const saved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/ipfs')).status, 401);
  cookie = saved;
  assert.equal((await call('PUT', '/api/admin/ipfs', { jwt: 'not a jwt' })).status, 400);
  const JWT = 'eyJhbGciOi.eyJ1c2VySW5mb3JtYXRpb24.SECRETSIG1234';
  const r = await call('PUT', '/api/admin/ipfs', { jwt: JWT });
  assert.equal(r.status, 200); assert.equal(r.json.configured, true); assert.equal(r.json.hint, '…1234');
  assert.ok(!JSON.stringify(r.json).includes('SECRETSIG'));
  assert.ok(!(await call('GET', '/fees-config.js')).buf.toString().includes('SECRETSIG'));
  assert.match((await call('GET', '/fees-config.js')).buf.toString(), /"ipfs":true/);
  const dbRows = await call('GET', '/api/admin/db/table?name=settings');
  assert.ok(!JSON.stringify(dbRows.json).includes('SECRETSIG'), 'database manager hides the key');

  const T = insertPaidOrder();                          // hosting only opens for a PAID order
  const pinned = []; const prev = global.fetch;
  global.fetch = (url, opts) => {
    if (!String(url).startsWith('https://api.pinata.cloud')) return prev(url, opts);
    assert.equal(opts.headers.Authorization, 'Bearer ' + JWT);
    pinned.push(String(url).split('.cloud')[1]);
    if (String(url).endsWith('testAuthentication')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ message: 'ok' }) });
    if (String(url).endsWith('pinJSONToIPFS')) pinned.json = JSON.parse(opts.body).pinataContent;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ IpfsHash: 'Qm' + String(pinned.length).repeat(10) }) });
  };
  try {
    assert.equal((await call('POST', '/api/admin/ipfs/test')).status, 200);
    const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');
    const fake = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64');
    assert.equal((await call('POST', '/api/upload-metadata', { ...T, metadata: { name: 'Meme', symbol: 'MEME', image: fake } })).status, 400, 'non-image bytes refused');
    const ok = await call('POST', '/api/upload-metadata', { ...T, metadata: { name: 'Meme', symbol: 'MEME', description: 'hi', image: png, banner: png,
      extensions: { website: 'https://x.io', twitter: 'javascript:alert(1)' }, evil: 'x', properties: { creators: [{ address: WALLET }] } } });
    assert.equal(ok.status, 200);
    assert.match(ok.json.uri, /^https:\/\/ipfs\.io\/ipfs\/Qm/);
    assert.ok(ok.json.image.startsWith('https://ipfs.io/ipfs/') && ok.json.banner.startsWith('https://ipfs.io/ipfs/'));
    assert.equal(pinned.filter(x => x === '/pinning/pinFileToIPFS').length, 2);
    assert.equal(pinned.json.extensions.website, 'https://x.io/');
    assert.equal(pinned.json.extensions.twitter, undefined, 'javascript: links dropped');
    assert.equal(pinned.json.evil, undefined, 'unknown fields dropped');
    assert.equal(pinned.json.properties.creators[0].address, WALLET);
    // sample upload + usage table
    const sm = await call('POST', '/api/admin/ipfs/sample');
    assert.equal(sm.status, 200);
    assert.match(sm.json.image, /^https:\/\/ipfs\.io\/ipfs\/Qm/); assert.match(sm.json.metadata, /^https:\/\/ipfs\.io\/ipfs\/Qm/);
    const lg = (await call('GET', '/api/admin/ipfs/log')).json;
    assert.ok(lg.summary.total >= 5 && lg.summary.failed === 0);
    assert.ok(lg.rows.every(r => r.key_hint === '…1234'), 'rows show only the last 4 key characters');
    assert.ok(lg.rows.some(r => r.source === 'sample' && r.kind === 'image') && lg.rows.some(r => r.source === 'visitor'));
    assert.ok(!JSON.stringify(lg).includes('SECRETSIG'));
    // sample upload with the admin's own picture
    const before = pinned.filter(x => x === '/pinning/pinFileToIPFS').length;
    const mine = await call('POST', '/api/admin/ipfs/sample', { image: png });
    assert.equal(mine.status, 200);
    assert.match(mine.json.image, /^https:\/\/ipfs\.io\/ipfs\/Qm/);
    assert.equal(pinned.filter(x => x === '/pinning/pinFileToIPFS').length, before + 1, 'the chosen picture is pinned');
    assert.equal(pinned.json.properties.files[0].type, 'image/png');
    assert.equal((await call('POST', '/api/admin/ipfs/sample', { image: fake })).status, 400, 'non-image bytes refused');
    assert.equal((await call('POST', '/api/admin/ipfs/sample', { image: 'data:image/png;base64,' + Buffer.alloc(2.2 * 1024 * 1024, 1).toString('base64') })).status, 413, 'oversized picture refused');
    global.fetch = (url, opts) => String(url).startsWith('https://api.pinata.cloud') ? Promise.resolve({ ok: false, status: 401, json: async () => ({}) }) : prev(url, opts);
    assert.equal((await call('POST', '/api/admin/ipfs/sample')).status, 502);
    const lg2 = (await call('GET', '/api/admin/ipfs/log')).json;
    assert.equal(lg2.rows[0].status, 'error'); assert.match(lg2.rows[0].error, /refused/);
    assert.equal((await call('GET', '/api/admin/ipfs/log')).status, 200);
  } finally { global.fetch = prev; }
  const saved2 = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/ipfs/log')).status, 401);
  assert.equal((await call('POST', '/api/admin/ipfs/sample')).status, 401);
  cookie = saved2;
  assert.equal((await call('PUT', '/api/admin/ipfs', { clear: true })).json.configured, false);
});

test('IPFS and site mode: nothing is uploaded during a dry run or maintenance', async () => {
  const JWT = 'eyJhbGciOi.eyJ1c2VySW5mb3JtYXRpb24.SECRETSIG1234';
  assert.equal((await call('PUT', '/api/admin/ipfs', { jwt: JWT })).status, 200);
  const prev = global.fetch; let pinataCalls = 0;
  global.fetch = (url, opts) => { if (String(url).startsWith('https://api.pinata.cloud')) { pinataCalls++; return Promise.resolve({ ok: true, status: 200, json: async () => ({ IpfsHash: 'Qm1' }) }); } return prev(url, opts); };
  try {
    for (const mode of ['dryrun', 'maintenance']) {
      assert.equal((await call('PUT', '/api/admin/mode', { mode })).status, 200);
      assert.equal((await call('POST', '/api/upload-metadata', { metadata: { name: 'Meme', symbol: 'MEME' } })).status, 503, mode);
    }
    assert.equal(pinataCalls, 0, 'Pinata was never contacted');
    assert.equal((await call('PUT', '/api/admin/mode', { mode: 'devnet' })).status, 200);
    assert.equal((await call('POST', '/api/upload-metadata', { ...insertPaidOrder(), metadata: { name: 'Meme', symbol: 'MEME' } })).status, 200, 'works again in a live mode');
  } finally { global.fetch = prev; await call('PUT', '/api/admin/mode', { mode: 'devnet' }); await call('PUT', '/api/admin/ipfs', { clear: true }); }
});

test('admin page: Overview has the revenue and visits charts, and the CSP only adds the one Chart.js host', async () => {
  const r = await fetch(base + '/admin.html');
  const csp = r.headers.get('content-security-policy') || '', html = await r.text();
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/);
  assert.doesNotMatch(csp, /script-src[^;]*\*/);
  assert.match(html, /id="chRev"/); assert.match(html, /id="chVis"/);
  assert.ok(html.indexOf('id="chRev"') < html.indexOf('id="liveCard"'), 'charts sit in the Overview, above Live activity');
});

test('admin page: the CSP lets "Test connection" reach an https RPC, but stays locked down otherwise', async () => {
  const r = await fetch(base + '/admin.html');
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/); assert.match(csp, /connect-src 'self' https:/);
  assert.doesNotMatch(csp, /script-src[^;]*(unsafe-inline|unsafe-eval)/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});


/* ---------------------------------------------------------------- PAY FIRST */
async function quote(address, extra = {}) { return call('POST', '/api/payment/quote', { address, features: [], hasSupply: true, ...extra }); }

test('pay first: the server works out the price itself, from its own prices', async () => {
  const w = rndAddr();
  const base = await quote(w);
  assert.equal(base.status, 200);
  assert.equal(base.json.status, 'pending');
  assert.equal(base.json.amount, 100_000_000 - 9_127_600);                       // 0.1 SOL minus the network cost, same as payment.js
  assert.equal(base.json.feeWallet, WALLET);
  assert.match(base.json.id, /^[0-9a-f]{16}$/); assert.ok(base.json.secret.length >= 32);
  const two = await quote(w, { features: ['banner', 'mintRevoke', 'bogus', 'banner'] });   // unknown + repeated features are ignored
  assert.equal(two.json.amount, 300_000_000 - 9_127_600);
  const noSupply = await quote(w, { hasSupply: false });
  assert.equal(noSupply.json.amount, 100_000_000 - (9_127_600 - 2_039_280));
  assert.equal((await quote('0x1234')).status, 400);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM orders').all()).includes(base.json.secret), 'the secret is stored only as a hash');
});

test('pay first: the payment is checked on-chain, then the order is paid and the money is booked once', async () => {
  const creator = rndAddr(), q = (await quote(creator)).json;
  const revenueBefore = (await report()).today.revenue_lamports;
  const sig = rnd(88);
  rpcTx = payTx({ order: q.id, creator, lamports: q.amount });
  assert.equal((await call('POST', '/api/payment/confirm', { id: q.id, secret: 'wrong', signature: sig })).status, 404, 'needs the secret');
  const ok = await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: sig });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'paid'); assert.equal(ok.json.paid, q.amount);
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(q.id);
  assert.equal(row.status, 'paid'); assert.equal(row.revenue_lamports, q.amount); assert.equal(row.signature, sig);
  assert.equal((await report()).today.revenue_lamports, revenueBefore + q.amount);
  const again = await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: sig });   // the page may ask twice
  assert.equal(again.status, 200);
  assert.equal((await report()).today.revenue_lamports, revenueBefore + q.amount, 'booked once');
});

test('pay first: a payment that is too small, from another wallet, without the memo, or to another wallet is refused', async () => {
  const creator = rndAddr(), q = (await quote(creator)).json;
  const bad = async (tx, why) => {
    rpcTx = tx;
    const r = await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: rnd(88) });
    assert.equal(r.status, 400, why); assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(q.id).status, 'pending', why);
  };
  await bad(payTx({ order: q.id, creator, lamports: q.amount - 1 }), 'one lamport short');
  await bad(payTx({ order: q.id, creator: rndAddr(), lamports: q.amount }), 'paid by a different wallet');
  await bad(payTx({ order: q.id, creator, lamports: q.amount, skipMemo: true }), 'no order reference');
  await bad(payTx({ order: q.id, creator, lamports: q.amount, memo: 'someone-elses-order' }), "another order's reference");
  await bad(payTx({ order: q.id, creator, lamports: q.amount, to: rndAddr() }), 'sent to some other wallet');
  await bad(payTx({ order: q.id, creator, lamports: q.amount, gain: 0 }), 'the revenue wallet did not actually gain');
  const failed = payTx({ order: q.id, creator, lamports: q.amount }); failed.meta.err = { InstructionError: [0, 'Custom'] };
  await bad(failed, 'a failed transaction');
  const stolen = (await quote(rndAddr())).json;                                  // someone else claims this payment for their own order
  rpcTx = payTx({ order: q.id, creator, lamports: q.amount });
  assert.equal((await call('POST', '/api/payment/confirm', { id: stolen.id, secret: stolen.secret, signature: rnd(88) })).status, 400);
  rpcTx = null;
  assert.equal((await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: rnd(88) })).status, 404, 'not on the network yet');
});

test('one step: IPFS hosting needs an order from the server (never an anonymous call), with a small limit per order', async () => {
  const JWT = 'eyJhbGciOi.eyJ1c2VySW5mb3JtYXRpb24.SECRETSIG1234';
  assert.equal((await call('PUT', '/api/admin/ipfs', { jwt: JWT })).status, 200);
  const prev = global.fetch; let pins = 0;
  global.fetch = (url, opts) => String(url).startsWith('https://api.pinata.cloud') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ IpfsHash: 'Qm' + (++pins) + 'x'.repeat(10) }) }) : prev(url, opts);
  try {
    const meta = n => ({ name: 'Meme' + n, symbol: 'MEME' });
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(0) })).status, 402, 'no order at all');
    const one = (await quote(rndAddr())).json;                                         // an order opened through the quote: nothing is paid yet
    assert.equal(one.status, 'pending');
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(0), order: one.id, secret: 'nope' })).status, 402, 'wrong secret');
    assert.equal(pins, 0, 'Pinata was never contacted without a valid order');
    const a = await call('POST', '/api/upload-metadata', { metadata: meta(0), order: one.id, secret: one.secret });
    assert.equal(a.status, 200); const pinsAfterFirst = pins; assert.ok(pinsAfterFirst > 0, 'the page hosts the logo BEFORE the one payment');
    const b = await call('POST', '/api/upload-metadata', { metadata: meta(0), order: one.id, secret: one.secret });
    assert.equal(b.status, 200); assert.deepEqual(b.json, a.json); assert.equal(pins, pinsAfterFirst, 'same details again = no second upload');
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(1), order: one.id, secret: one.secret })).status, 200);
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(2), order: one.id, secret: one.secret })).status, 429, 'an unpaid order gets only 2 hosting runs (v1.14)');
    const old = insertPaidOrder();                                                     // an order paid separately by the older version keeps its larger allowance
    db.prepare('UPDATE orders SET hosts = 4 WHERE id = ?').run(old.order);              // (the per-visitor limit of 12 uploads an hour is shared by all tests, so the allowance is set directly)
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(10), order: old.order, secret: old.secret })).status, 200, 'a 5th run is still fine for a paid order');
    assert.equal((await call('POST', '/api/upload-metadata', { metadata: meta(11), order: old.order, secret: old.secret })).status, 429);
  } finally { global.fetch = prev; await call('PUT', '/api/admin/ipfs', { clear: true }); }
});

test('one step: the fee travels inside the creation transaction; the token is recorded from the chain and the order is used up once', async () => {
  const creator = rndAddr(), q = (await quote(creator, { features: ['banner'] })).json;
  assert.equal(q.status, 'pending');
  const before = (await report()).today, mint = rndAddr(), signature = rnd(88);
  // ONE transaction: the wallet pays network cost + service fee together, the revenue wallet gains exactly the service fee
  const fee = 160_000_000 - 6_700_000, network = 6_700_000;
  const total = fee + network;
  assert.equal(total, 160_000_000, 'what the visitor pays is exactly the price (0.1 creation + 0.06 features here), the network cost is INSIDE it');
  rpcTx = fakeTx({ creator, mint, feeDelta: fee, payerPaid: total });
  const r = await call('POST', '/api/token-created', { signature, mint, order: q.id, secret: q.secret });
  assert.equal(r.status, 200); assert.equal(r.json.paidFirst, false, 'not a separately paid (older) order');
  assert.equal(r.json.revenue, fee / 1e9); assert.equal(r.json.paid, total / 1e9);
  const tok = db.prepare('SELECT * FROM tokens WHERE signature = ?').get(signature);
  assert.equal(tok.revenue_lamports, fee); assert.equal(tok.paid_lamports, total); assert.equal(tok.network_lamports, network);
  assert.equal(tok.order_id, '', 'one-step tokens are not flagged as paid-first');
  const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(q.id);
  assert.equal(ord.status, 'used'); assert.equal(ord.token_signature, signature); assert.equal(ord.revenue_lamports, fee);
  const after = (await report()).today;
  assert.equal(after.tokens, before.tokens + 1);
  assert.equal(after.revenue_lamports, before.revenue_lamports + fee, 'the revenue is booked ONCE, when the token is created');
  assert.equal(after.spent_lamports, before.spent_lamports + total);

  // the same order cannot be reused, and another wallet cannot borrow it: those tokens still count, just without the order
  const mint2 = rndAddr(), sig2 = rnd(88);
  rpcTx = fakeTx({ creator, mint: mint2, feeDelta: fee, payerPaid: total });
  assert.equal((await call('POST', '/api/token-created', { signature: sig2, mint: mint2, order: q.id, secret: q.secret })).status, 200);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(q.id).status, 'used');
  const q2 = (await quote(rndAddr())).json, mint3 = rndAddr(), sig3 = rnd(88);
  rpcTx = fakeTx({ creator: rndAddr(), mint: mint3, feeDelta: fee, payerPaid: total });
  assert.equal((await call('POST', '/api/token-created', { signature: sig3, mint: mint3, order: q2.id, secret: q2.secret })).status, 200);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(q2.id).status, 'pending', "another wallet's order stays unused");
});

test('one step: the quote reuses the same open order, so a cancelled wallet popup never hosts the logo twice', async () => {
  const w = rndAddr(), a = (await quote(w)).json;
  const again = await quote(w, { resume: [{ id: a.id, secret: a.secret }] });
  assert.equal(again.json.id, a.id); assert.equal(again.json.status, 'pending'); assert.equal(again.json.secret, undefined);
});

test('pay first: a paid order is used for ONE token, by the wallet that paid; revenue is not counted twice', async () => {
  const T = insertPaidOrder(rndAddr(), 290_872_400);
  const before = (await report()).today;
  const mint = rndAddr(), signature = rnd(88);
  rpcTx = fakeTx({ creator: T.wallet, mint, feeDelta: 0, payerPaid: 9_127_600 });   // the creation transaction no longer carries the fee
  const r = await call('POST', '/api/token-created', { signature, mint, order: T.order, secret: T.secret });
  assert.equal(r.status, 200); assert.equal(r.json.paidFirst, true);
  const tok = db.prepare('SELECT * FROM tokens WHERE signature = ?').get(signature);
  assert.equal(tok.order_id, T.order);
  assert.equal(tok.revenue_lamports, 290_872_400, 'the token shows the fee its order paid');
  assert.equal(tok.paid_lamports, 9_127_600 + 290_872_400, 'spent = network cost + service fee');
  assert.equal(tok.network_lamports, 9_127_600);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(T.order).status, 'used');
  const after = (await report()).today;
  assert.equal(after.tokens, before.tokens + 1);
  assert.equal(after.revenue_lamports, before.revenue_lamports, 'the fee was booked when it was paid, not again here');

  const mint2 = rndAddr(), sig2 = rnd(88);                                           // same order again = not a paid creation any more
  rpcTx = fakeTx({ creator: T.wallet, mint: mint2, feeDelta: 0, payerPaid: 9_127_600 });
  assert.equal((await call('POST', '/api/token-created', { signature: sig2, mint: mint2, order: T.order, secret: T.secret })).json.paidFirst, false);
  const other = insertPaidOrder(rndAddr());                                          // another wallet's order cannot be borrowed
  const mint3 = rndAddr(), sig3 = rnd(88);
  rpcTx = fakeTx({ creator: rndAddr(), mint: mint3, feeDelta: 0, payerPaid: 9_127_600 });
  assert.equal((await call('POST', '/api/token-created', { signature: sig3, mint: mint3, order: other.order, secret: other.secret })).json.paidFirst, false);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(other.order).status, 'paid', 'still unused');
});

test('pay first: someone who already paid is not asked to pay again; free prices need no payment; closed modes refuse quotes', async () => {
  const w = rndAddr(), q = (await quote(w)).json;
  rpcTx = payTx({ order: q.id, creator: w, lamports: q.amount });
  assert.equal((await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: rnd(88) })).status, 200);
  const n = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const again = await quote(w, { resume: [{ id: q.id, secret: q.secret }] });
  assert.equal(again.json.status, 'paid'); assert.equal(again.json.id, q.id); assert.equal(again.json.secret, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM orders').get().c, n, 'no new order');
  const dearer = await quote(w, { features: ['banner', 'social', 'creator'], resume: [{ id: q.id, secret: q.secret }] });   // costs more than was paid → a new order for the new price
  assert.equal(dearer.json.status, 'pending'); assert.notEqual(dearer.json.id, q.id);
  assert.equal((await quote(rndAddr(), { resume: [{ id: q.id, secret: q.secret }] })).json.status, 'pending', "another wallet cannot use this payment");

  const saved = db.prepare('SELECT key, amount FROM fees').all();
  db.prepare('UPDATE fees SET amount = 0').run();
  try { const free = await quote(rndAddr()); assert.equal(free.json.status, 'paid'); assert.equal(free.json.amount, 0); }
  finally { for (const f of saved) db.prepare('UPDATE fees SET amount = ? WHERE key = ?').run(f.amount, f.key); }

  for (const mode of ['maintenance', 'dryrun']) {
    assert.equal((await call('PUT', '/api/admin/mode', { mode })).status, 200);
    assert.equal((await quote(rndAddr())).status, 503, mode);
  }
  assert.equal((await call('PUT', '/api/admin/mode', { mode: 'devnet' })).status, 200);
});

test('pay first: the owner testing with their own revenue wallet can create, but it earns (and books) nothing', async () => {
  const q = (await quote(WALLET)).json, before = (await report()).today.revenue_lamports;
  rpcTx = payTx({ order: q.id, creator: WALLET, lamports: q.amount, gain: 0 });
  assert.equal((await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: rnd(88) })).status, 200);
  assert.equal(db.prepare('SELECT revenue_lamports r FROM orders WHERE id = ?').get(q.id).r, 0);
  assert.equal((await report()).today.revenue_lamports, before);
});

test('pay first: even the owner\'s own wallet must pay the full fee to unlock an order', async () => {
  const q = (await quote(WALLET)).json;
  rpcTx = payTx({ order: q.id, creator: WALLET, lamports: q.amount - 1, gain: 0 });
  assert.equal((await call('POST', '/api/payment/confirm', { id: q.id, secret: q.secret, signature: rnd(88) })).status, 400);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(q.id).status, 'pending');
});

test('pay first: the orders table is visible to the admin without its secrets', async () => {
  const t = (await call('GET', '/api/admin/db/table?name=orders')).json;
  assert.ok(t.total > 0); assert.ok(t.rows.every(r => r.secret_hash === '••••••••'));
});

/* ---------------------------------------------------------------- fee-received e-mail */
const { fakeSmtp: realFakeSmtp, bodyOf } = require('./fake-smtp.js');
const openSmtp = [];
const fakeSmtp = async o => { const s = await realFakeSmtp(o); openSmtp.push(s); return s; };
test.after(() => openSmtp.forEach(s => s.close()));
const waitFor = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); } return fn(); };

test('email settings: locked, validated, and the password never comes back', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/email')).status, 401);
  assert.equal((await call('POST', '/api/admin/email/test')).status, 401);
  cookie = saved;
  const off = await call('GET', '/api/admin/email');
  assert.equal(off.json.enabled, false);                                            // OFF until the admin turns it on
  assert.equal((await call('PUT', '/api/admin/email', { enabled: true })).status, 400);                      // no recipient yet
  assert.equal((await call('PUT', '/api/admin/email', { to: 'not-an-email' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/email', { currency: 'EUR' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/email', { subject: '   ' })).status, 400);
});

test('test e-mail goes out through the mail server with the admin-written message, in PHP', async () => {
  const smtp = await fakeSmtp({ requireAuth: true });
  const r = await call('PUT', '/api/admin/email', { to: 'owner@example.com', currency: 'PHP', subject: 'MF: {sol} SOL', body: 'Total {sol} SOL = {converted} on {network}',
    smtp: { host: '127.0.0.1', port: smtp.port, secure: 'none', user: 'me@x.test', pass: 'secret', from: 'me@x.test' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.smtp.passSet, true);
  assert.doesNotMatch(JSON.stringify(r.json), /secret/);                            // the password is never sent back to the browser
  const t = await call('POST', '/api/admin/email/test');
  assert.equal(t.status, 200);
  assert.equal(smtp.mails.length, 1);
  const sol1 = /^Subject: MF: (\d+(?:\.\d+)?) SOL$/m.exec(smtp.mails[0].raw)?.[1];
  assert.ok(sol1 && Number(sol1) >= 0.05 && Number(sol1) <= 1, 'the test e-mail shows a random amount between 0.05 and 1 SOL');
  assert.equal(bodyOf(smtp.mails[0].raw), 'Total ' + sol1 + ' SOL = devnet test SOL, no real value on Devnet (test)');   // subject and body agree
  assert.equal((await call('GET', '/api/admin/email')).json.last.ok, true);
  smtp.close();
});

test('v1.17: e-mail can go out through Resend (HTTPS) instead of SMTP, and the key never comes back', async () => {
  const http = require('node:http');
  const seen = [];
  const api = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { seen.push({ auth: req.headers.authorization, json: JSON.parse(b) }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}'); }); });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'resend_api_url'").run('http://127.0.0.1:' + api.address().port + '/emails');
  try {
    assert.equal((await call('GET', '/api/admin/email')).json.method, 'smtp', 'SMTP stays the default, so older sites keep working');
    assert.equal((await call('PUT', '/api/admin/email', { method: 'pigeon' })).status, 400);
    assert.equal((await call('PUT', '/api/admin/email', { resend: { key: 'not a key' } })).status, 400);
    assert.equal((await call('PUT', '/api/admin/email', { resend: { from: 'nope' } })).status, 400);
    const saved = await call('PUT', '/api/admin/email', { method: 'resend', to: 'owner@example.com', subject: 'MF: {sol} SOL', body: 'Total {sol} SOL', resend: { key: 're_secretkey1234567', from: 'MemeForge <onboarding@resend.dev>' } });
    assert.equal(saved.status, 200); assert.equal(saved.json.method, 'resend'); assert.equal(saved.json.resend.keySet, true);
    assert.doesNotMatch(JSON.stringify(saved.json), /re_secretkey/);                  // the key is never sent back to the browser
    assert.equal((await call('POST', '/api/admin/email/test')).status, 200);
    assert.equal(seen.length, 1); assert.equal(seen[0].auth, 'Bearer re_secretkey1234567');
    assert.deepEqual(seen[0].json.to, ['owner@example.com']); assert.match(seen[0].json.subject, /^MF: \d/);
    assert.equal((await call('GET', '/api/admin/email')).json.last.ok, true);
    // switching ON needs the key
    await call('PUT', '/api/admin/email', { resend: { clearKey: true } });
    assert.equal((await call('PUT', '/api/admin/email', { enabled: true })).status, 400);
    assert.equal((await call('POST', '/api/admin/email/test')).status, 400);
  } finally {
    await call('PUT', '/api/admin/email', { method: 'smtp', enabled: false });
    db.prepare("UPDATE settings SET value = '' WHERE key = 'resend_api_url'").run();
    api.close();
  }
});

test('every test e-mail gets its own random SOL amount', async () => {
  const smtp = await fakeSmtp({ requireAuth: true });
  await call('PUT', '/api/admin/email', { to: 'owner@example.com', subject: 'MF: {sol} SOL', body: '{sol}',
    smtp: { host: '127.0.0.1', port: smtp.port, secure: 'none', user: 'me@x.test', pass: 'secret', from: 'me@x.test' } });
  for (let i = 0; i < 6; i++) assert.equal((await call('POST', '/api/admin/email/test')).status, 200);
  const amounts = smtp.mails.map(m => bodyOf(m.raw));
  assert.equal(amounts.length, 6);
  assert.ok(new Set(amounts).size > 1, 'the amount changes between test e-mails: ' + amounts.join(', '));
  assert.ok(amounts.every(a => Number(a) >= 0.05 && Number(a) <= 1));
  smtp.close();
});

test('a wrong mail password is reported to the admin instead of failing silently', async () => {
  const smtp = await fakeSmtp({ requireAuth: true });
  await call('PUT', '/api/admin/email', { smtp: { host: '127.0.0.1', port: smtp.port, secure: 'none', user: 'me@x.test', pass: 'WRONG' } });
  const t = await call('POST', '/api/admin/email/test');
  assert.equal(t.status, 502);
  assert.match(t.json.error || t.json.message || JSON.stringify(t.json), /user name and password/);
  const last = (await call('GET', '/api/admin/email')).json.last;
  assert.equal(last.ok, false);
  smtp.close();
});

test('a token creation e-mails the fee once; devnet is quiet unless switched on; a duplicate sends nothing', async () => {
  const smtp = await fakeSmtp({ requireAuth: true });
  const smtpCfg = { host: '127.0.0.1', port: smtp.port, secure: 'none', user: 'me@x.test', pass: 'secret', from: 'me@x.test' };
  assert.equal((await call('PUT', '/api/admin/email', { enabled: true, devnet: false, to: 'owner@example.com', currency: 'PHP',
    subject: 'Fee received: {sol} SOL', body: '{sol} SOL from {creator} for {token_name} ({token_symbol})', smtp: smtpCfg })).status, 200);

  let mint = rndAddr(), signature = rnd(88);
  rpcTx = fakeTx({ mint, name: 'Mail Coin', symbol: 'MAIL' });
  assert.equal((await call('POST', '/api/token-created', { signature, mint })).status, 200);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(smtp.mails.length, 0);                                               // devnet payments do not e-mail by default

  await call('PUT', '/api/admin/email', { devnet: true });
  mint = rndAddr(); signature = rnd(88);
  rpcTx = fakeTx({ mint, name: 'Mail Coin', symbol: 'MAIL' });
  assert.equal((await call('POST', '/api/token-created', { signature, mint })).status, 200);
  await waitFor(() => smtp.mails.length >= 1);
  assert.equal(smtp.mails.length, 1);
  assert.match(smtp.mails[0].raw, /^Subject: Fee received: 0\.6908724 SOL$/m);
  assert.match(bodyOf(smtp.mails[0].raw), /^0\.6908724 SOL from \w+ for Mail Coin \(MAIL\)$/);

  assert.equal((await call('POST', '/api/token-created', { signature, mint })).json.duplicate, true);   // same signature again
  await new Promise(r => setTimeout(r, 200));
  assert.equal(smtp.mails.length, 1);                                               // never e-mailed twice

  await call('PUT', '/api/admin/email', { enabled: false });                        // switched OFF: nothing is sent
  mint = rndAddr(); signature = rnd(88); rpcTx = fakeTx({ mint });
  await call('POST', '/api/token-created', { signature, mint });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(smtp.mails.length, 1);
  smtp.close();
});

/* ---------------------------------------------------------------- v1.14: underpaid flag + hosting limits */
test('underpaid flag: a token whose fee did not reach the revenue wallet is marked; honest ones, rounding and your own test tokens are not', async () => {
  rateBuckets.clear();                                               // all tests share one IP and recording tokens is limited per IP
  const EXPECTED = 100_000_000 - 9_127_600;                         // the base price minus the network cost (what the quote asks)
  const make = async ({ feeDelta, creator = rndAddr(), feeAsCreator = false, order = true }) => {
    const q = order ? (await quote(creator)).json : null, mint = rndAddr(), signature = rnd(88);
    rpcTx = fakeTx({ creator, mint, feeDelta, payerPaid: feeDelta + 9_127_600, feeAsCreator });
    const r = await call('POST', '/api/token-created', { signature, mint, ...(q ? { order: q.id, secret: q.secret } : {}) });
    assert.equal(r.status, 200);
    return db.prepare('SELECT expected_lamports, underpaid FROM tokens WHERE signature = ?').get(signature);
  };
  const full = await make({ feeDelta: EXPECTED });
  assert.equal(full.underpaid, 0); assert.equal(full.expected_lamports, EXPECTED);
  assert.equal((await make({ feeDelta: EXPECTED - 5_000 })).underpaid, 0, 'a few thousand lamports of rounding is not flagged');
  const skipped = await make({ feeDelta: 0 });                       // the visitor edited the page and left the fee out
  assert.equal(skipped.underpaid, 1); assert.equal(skipped.expected_lamports, EXPECTED);
  assert.equal((await make({ feeDelta: Math.floor(EXPECTED / 2) })).underpaid, 1, 'half the fee is flagged too');
  assert.equal((await make({ feeDelta: 0, order: false })).underpaid, 1, 'no order at all: the base price is still expected');
  assert.equal((await make({ feeDelta: 0, creator: WALLET, feeAsCreator: true })).underpaid, 0, 'you testing with your own revenue wallet is never flagged');
  const T = insertPaidOrder(rndAddr(), EXPECTED), mint = rndAddr(), signature = rnd(88);   // pay-first: its fee was verified when it was paid
  rpcTx = fakeTx({ creator: T.wallet, mint, feeDelta: 0, payerPaid: 9_127_600 });
  assert.equal((await call('POST', '/api/token-created', { signature, mint, order: T.order, secret: T.secret })).status, 200);
  assert.equal(db.prepare('SELECT underpaid FROM tokens WHERE signature = ?').get(signature).underpaid, 0);

  const list = (await call('GET', '/api/admin/tokens?network=devnet&size=100')).json;
  const n = db.prepare("SELECT COUNT(*) c FROM tokens WHERE network = 'devnet' AND underpaid = 1").get().c;
  assert.ok(n >= 3); assert.equal(list.underpaid, n, 'the admin gets the number of underpaid tokens');
  assert.ok(list.rows.some(r => r.underpaid === 1 && r.expected_lamports === EXPECTED), 'rows carry the flag and the expected fee');
  const csv = (await call('GET', '/api/admin/tokens.csv?network=devnet')).buf.toString();
  assert.match(csv.split('\n')[0], /expected_sol,underpaid/); assert.match(csv, /,YES,/);
  rpcTx = null;
});

test('hosting limits: no free hosting for a wallet that cannot pay, a daily cap per wallet, and all of it is set in admin', async () => {
  rateBuckets.clear();                                               // every test shares one IP, and hosting is limited per IP
  const JWT = 'eyJhbGciOi.eyJ1c2VySW5mb3JtYXRpb24.SECRETSIG1234';
  assert.equal((await call('PUT', '/api/admin/ipfs', { jwt: JWT })).status, 200);
  const prev = global.fetch; let pins = 0;
  global.fetch = (url, opts) => String(url).startsWith('https://api.pinata.cloud') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ IpfsHash: 'Qm' + (++pins) + 'x'.repeat(10) }) }) : prev(url, opts);
  const up = (o, n) => call('POST', '/api/upload-metadata', { metadata: { name: 'Meme' + n, symbol: 'MEME' }, order: o.id, secret: o.secret });
  const hosts = o => db.prepare('SELECT hosts FROM orders WHERE id = ?').get(o.id).hosts;
  try {
    // defaults, and the admin can read and change them
    assert.deepEqual((await call('GET', '/api/admin/ipfs')).json.limits, { order: 2, walletDay: 6, checkBalance: true });
    assert.equal((await call('PUT', '/api/admin/ipfs', { hostMaxOrder: 0 })).status, 400);
    assert.equal((await call('PUT', '/api/admin/ipfs', { hostMaxWalletDay: 'lots' })).status, 400);

    // the wallet must be able to pay the exact total (price 0.1 SOL = 100,000,000 lamports)
    const o = (await quote(rndAddr())).json;
    rpcTx = { context: { slot: 1 }, value: 5_000_000 };
    const poor = await up(o, 0);
    assert.equal(poor.status, 402); assert.match(poor.json.error, /needs 0\.1000 SOL/); assert.equal(pins, 0, 'nothing was pinned'); assert.equal(hosts(o), 0, 'a refused run is not counted');
    rpcTx = { value: 99_999_999 }; assert.equal((await up(o, 0)).status, 402, 'one lamport short is refused');
    rpcTx = { value: 100_000_000 }; assert.equal((await up(o, 0)).status, 200, 'exactly enough is fine'); assert.equal(hosts(o), 1);
    rpcTx = null;                                                    // the RPC cannot say: the check is skipped, a sale is never blocked by a hiccup
    assert.equal((await up(o, 1)).status, 200);
    // a wallet that is out of SOL is allowed when the check is switched off
    assert.equal((await call('PUT', '/api/admin/ipfs', { checkBalance: false })).json.limits.checkBalance, false);
    const o2 = (await quote(rndAddr())).json; rpcTx = { value: 0 };
    assert.equal((await up(o2, 0)).status, 200, 'check off');
    assert.equal((await call('PUT', '/api/admin/ipfs', { checkBalance: true })).json.limits.checkBalance, true);

    // one wallet cannot open order after order for free hosting
    rateBuckets.clear(); rpcTx = { value: 5_000_000_000 };
    assert.equal((await call('PUT', '/api/admin/ipfs', { hostMaxWalletDay: 2, hostMaxOrder: 3 })).status, 200);
    const w = rndAddr(), a = (await quote(w)).json, b = (await quote(w)).json, c = (await quote(w)).json;
    assert.notEqual(a.id, b.id);
    assert.equal((await up(a, 0)).status, 200); assert.equal((await up(b, 0)).status, 200);
    const capped = await up(c, 0);
    assert.equal(capped.status, 429); assert.match(capped.json.error, /free hosting attempts for today/);
    db.prepare("UPDATE orders SET status = 'used' WHERE id = ?").run(a.id);          // a token was really created with this order: it no longer counts
    assert.equal((await up(c, 0)).status, 200, 'finishing a token frees the wallet again');
    assert.equal((await up((await quote(rndAddr())).json, 0)).status, 200, 'other wallets are not affected');
    assert.equal((await up(b, 1)).status, 429, 'the wallet is back at its cap');
  } finally {
    global.fetch = prev; rpcTx = null;
    await call('PUT', '/api/admin/ipfs', { hostMaxOrder: 2, hostMaxWalletDay: 6, checkBalance: true });
    await call('PUT', '/api/admin/ipfs', { clear: true });
  }
});

/* ---------------------------------------------------------------- v1.15: daily token cap + editable per-visitor limits */
test('limits: a daily token cap closes new orders for the day, the creator page is told, and the per-visitor limits are editable', async () => {
  rateBuckets.clear();
  const cfg = async () => JSON.parse((await call('GET', '/fees-config.js')).buf.toString().replace(/^window\.MEMEFORGE_CONFIG = /, '').replace(/;$/, ''));
  const first = (await call('GET', '/api/admin/limits')).json;
  assert.equal(first.maxTokensDay, 0, 'no daily limit by default'); assert.deepEqual(first.perHour, { quote: 40, upload: 12, token: 20 });
  assert.equal(first.full, false); assert.equal((await cfg()).dailyFull, false);
  const today = first.tokensToday;
  // validation: nothing is saved when one number is bad
  assert.equal((await call('PUT', '/api/admin/limits', { maxTokensDay: -1 })).status, 400);
  assert.equal((await call('PUT', '/api/admin/limits', { maxTokensDay: 5, perHour: { quote: 0 } })).status, 400);
  assert.equal((await call('GET', '/api/admin/limits')).json.maxTokensDay, 0, 'a refused save changes nothing');
  assert.equal((await call('PUT', '/api/admin/limits', { maxTokensDay: 'many' })).status, 400);
  const cookieSaved = cookie; cookie = '';
  assert.equal((await call('GET', '/api/admin/limits')).status, 401, 'admin only'); cookie = cookieSaved;

  // the cap is reached: no new orders, and the page is told
  const capped = (await call('PUT', '/api/admin/limits', { maxTokensDay: Math.max(today, 1) })).json;
  if (today === 0) db.prepare("INSERT INTO daily_stats(day, network, tokens) VALUES (?, 'devnet', 1) ON CONFLICT(day, network) DO UPDATE SET tokens = tokens + 1").run(day(0));
  const nowFull = (await call('GET', '/api/admin/limits')).json;
  assert.equal(nowFull.full, true); assert.equal((await cfg()).dailyFull, true);
  const w = rndAddr(), blocked = await quote(w);
  assert.equal(blocked.status, 503); assert.match(blocked.json.error, /limit of \d+ tokens has been reached.*tomorrow/);
  // someone who already PAID an order (older pay-first version) can still finish it
  const T = insertPaidOrder(w);
  const resumed = await quote(w, { resume: [{ id: T.order, secret: T.secret }] });
  assert.equal(resumed.status, 200); assert.equal(resumed.json.id, T.order);
  // one more place left today: orders open again
  assert.equal((await call('PUT', '/api/admin/limits', { maxTokensDay: nowFull.tokensToday + 1 })).json.full, false);
  assert.equal((await quote(rndAddr())).status, 200); assert.equal((await cfg()).dailyFull, false);
  // 0 = no limit
  assert.equal((await call('PUT', '/api/admin/limits', { maxTokensDay: 0 })).json.full, false);

  // v1.16: the on/off switch. OFF = unlimited, but the number is kept for when it is switched on again
  const sw1 = (await call('PUT', '/api/admin/limits', { dailyOn: true, maxTokensDay: Math.max(nowFull.tokensToday, 1) })).json;
  assert.equal(sw1.dailyOn, true); assert.equal(sw1.full, true);
  assert.equal((await quote(rndAddr())).status, 503, 'ON and full: new orders are refused');
  const sw2 = (await call('PUT', '/api/admin/limits', { dailyOn: false })).json;
  assert.equal(sw2.dailyOn, false); assert.equal(sw2.full, false); assert.equal(sw2.maxTokensDay, Math.max(nowFull.tokensToday, 1), 'the number is kept');
  assert.equal((await quote(rndAddr())).status, 200, 'OFF: unlimited'); assert.equal((await cfg()).dailyFull, false);
  assert.equal((await call('PUT', '/api/admin/limits', { dailyOn: true })).json.full, true, 'switching ON again uses the kept number');
  assert.equal((await call('PUT', '/api/admin/limits', { dailyOn: true, maxTokensDay: 0 })).status, 400, 'ON needs a number from 1');
  assert.equal((await call('PUT', '/api/admin/limits', { dailyOn: 'yes' })).status, 400);
  await call('PUT', '/api/admin/limits', { dailyOn: false });

  // per-visitor limits are the admin's numbers now
  rateBuckets.clear();
  assert.equal((await call('PUT', '/api/admin/limits', { perHour: { quote: 2, upload: 3, token: 4 } })).status, 200);
  assert.deepEqual((await call('GET', '/api/admin/limits')).json.perHour, { quote: 2, upload: 3, token: 4 });
  assert.equal((await quote(rndAddr())).status, 200); assert.equal((await quote(rndAddr())).status, 200);
  assert.equal((await quote(rndAddr())).status, 429, 'the third quote in an hour is refused');
  rateBuckets.clear();
  assert.equal((await call('PUT', '/api/admin/limits', { perHour: { quote: 40, upload: 12, token: 20 } })).status, 200);
  assert.equal((await quote(rndAddr())).status, 200, 'back to the default numbers');
});
