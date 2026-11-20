/* =====================================================================
   MemeForge — site-mode.js
   Reads the mode the admin chose (admin → Site mode) from fees-config.js and shows it:

     devnet / mainnet   nothing extra (the pages already show the network)
     dryrun             a slim strip at the top: "nothing is sent or charged"
     maintenance        a full-screen, friendly "we'll be back" page with the date and time

   It also publishes  window.MF_MODE = { mode, dryRun, maintenance, showDryTable }  for the token creator.
   Load it right after fees-config.js. Text is only ever set with textContent, never as markup, so nothing
   the admin types can turn into HTML.
   ===================================================================== */
(function () {
  'use strict';
  var C = window.MEMEFORGE_CONFIG || {};
  var MODES = ['devnet', 'mainnet', 'dryrun', 'maintenance'];
  var mode = MODES.indexOf(C.mode) >= 0 ? C.mode : (String(C.network || '').toLowerCase() === 'devnet' ? 'devnet' : 'mainnet');
  window.MF_MODE = { mode: mode, dryRun: mode === 'dryrun', maintenance: mode === 'maintenance', showDryTable: !!(C.dryRun && C.dryRun.table) };

  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function icon(paths, cls) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    paths.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  var WRENCH = ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'];
  var FLASK = ['M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5L14.2 10.4a2 2 0 0 1-.2-.9V2', 'M8.5 2h7', 'M7 16h10'];

  var css = el('style');
  css.textContent =
    '.mf-dry{position:relative;z-index:70;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:8px 16px;text-align:center;' +
      'font:600 13px/1.45 var(--body,system-ui,sans-serif);color:var(--cyan,#27e8ff);background:rgba(39,232,255,.1);border-bottom:1px solid rgba(39,232,255,.35)}' +
    '.mf-dry svg{width:16px;height:16px;flex:none}.mf-dry b{color:#fff;font-weight:700}' +
    '.mfm{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;' +
      'background:radial-gradient(60vw 50vh at 85% 0%,rgba(255,61,242,.28),transparent 70%),radial-gradient(55vw 55vh at 0% 100%,rgba(39,232,255,.2),transparent 70%),linear-gradient(180deg,#0a0614,#120a24);' +
      'color:var(--text,#f6f2ff);font-family:var(--body,"Space Grotesk",system-ui,sans-serif)}' +
    '.mfm-card{width:100%;max-width:560px;margin:auto;text-align:center;padding:38px 28px 30px;border-radius:32px;' +
      'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);box-shadow:0 30px 90px rgba(139,77,255,.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}' +
    '.mfm-ic{width:84px;height:84px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;color:#6b4300;' +
      'background:radial-gradient(circle at 32% 28%,#fff6b8,#ffd23f 45%,#e69b00);border:3px solid #b87400;box-shadow:0 0 40px rgba(255,210,63,.45),inset 0 -6px 12px rgba(0,0,0,.18)}' +
    '.mfm-ic svg{width:40px;height:40px}' +
    '.mfm h1{font-family:var(--display,"Bungee",Impact,"Arial Black",sans-serif);font-weight:400;font-size:clamp(26px,6vw,38px);line-height:1.1;letter-spacing:.4px;text-transform:uppercase;margin:0 0 14px}' +
    '.mfm-msg{color:var(--muted,#a79fc4);font-size:16.5px;line-height:1.6;margin:0 auto;max-width:44ch}' +
    '.mfm-when{margin:26px auto 0;padding:16px 18px;border-radius:20px;background:rgba(182,255,59,.08);border:1px solid rgba(182,255,59,.35)}' +
    '.mfm-lbl{display:block;font-size:12.5px;font-weight:700;color:var(--muted,#a79fc4);margin-bottom:6px}' +
    '.mfm-date{display:block;font-size:19px;font-weight:700;color:var(--lime,#b6ff3b)}' +
    '.mfm-time{display:block;font-size:15px;font-weight:600;margin-top:2px}' +
    '.mfm-count{display:flex;justify-content:center;gap:10px;margin-top:20px}' +
    '.mfm-u{min-width:68px;padding:10px 8px;border-radius:16px;background:rgba(10,6,20,.55);border:1px solid rgba(255,255,255,.14)}' +
    '.mfm-u b{display:block;font:700 26px/1.1 var(--mono,ui-monospace,Menlo,Consolas,monospace);font-variant-numeric:tabular-nums}' +
    '.mfm-u span{display:block;margin-top:3px;font-size:11.5px;font-weight:600;color:var(--muted,#a79fc4)}' +
    '.mfm-note{margin:18px 0 0;font-size:13px;color:var(--muted,#a79fc4)}' +
    '.mfm-foot{margin:22px 0 0;padding-top:18px;border-top:1px solid rgba(255,255,255,.12);font-size:13px;color:var(--muted,#a79fc4)}' +
    '@media (max-width:420px){.mfm-card{padding:30px 18px 24px;border-radius:26px}.mfm-u{min-width:58px}.mfm-u b{font-size:22px}}' +
    '@media (prefers-reduced-motion:no-preference){.mfm-card{animation:mfmIn .5s cubic-bezier(.22,1,.36,1)}@keyframes mfmIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}}';
  document.head.appendChild(css);

  /* ---------- dry run: a slim strip ---------- */
  if (mode === 'dryrun') {
    var strip = el('div', 'mf-dry'); strip.setAttribute('role', 'status');
    strip.append(icon(FLASK), el('b', '', 'Dry run'), el('span', '', 'Nothing is signed, sent or charged. You will see exactly what would happen.'));
    document.body.insertBefore(strip, document.body.firstChild);
  }

  /* ---------- maintenance: a full-screen friendly page ---------- */
  if (mode === 'maintenance') {
    var M = C.maintenance || {};
    var title = M.title || 'We’ll be right back';
    var msg = M.message || 'MemeForge is getting a little upgrade. Thank you for your patience!';
    var untilMs = typeof M.untilMs === 'number' ? M.untilMs : null;
    var skew = typeof M.serverNow === 'number' ? M.serverNow - Date.now() : 0;      // the visitor's clock may be off: count against the server's

    // nothing behind the page can be reached with the keyboard (older browsers just have the cover)
    Array.prototype.forEach.call(document.body.children, function (n) { try { n.inert = true; } catch (e) { /* ignore */ } });
    document.documentElement.style.overflow = 'hidden';
    document.title = title + ' — MemeForge';

    var ov = el('div', 'mfm'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'mfmT');
    var card = el('div', 'mfm-card');
    var ic = el('div', 'mfm-ic'); ic.appendChild(icon(WRENCH));
    var h = el('h1', '', title); h.id = 'mfmT';
    card.append(ic, h, el('p', 'mfm-msg', msg));

    var units = null, note = null;
    if (untilMs != null) {
      var when = new Date(untilMs);
      var date = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(when);
      var time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(when);
      var box = el('div', 'mfm-when');
      box.append(el('span', 'mfm-lbl', 'We expect to be back on'), el('b', 'mfm-date', date), el('b', 'mfm-time', 'at ' + time + ' (your local time)'));
      card.appendChild(box);
      if (M.countdown) {
        var row = el('div', 'mfm-count'); row.setAttribute('role', 'timer'); row.setAttribute('aria-label', 'Time until we are back');
        units = {};
        [['d', 'days'], ['h', 'hours'], ['m', 'min'], ['s', 'sec']].forEach(function (u) {
          var cell = el('div', 'mfm-u'), b = el('b', '', '00');
          cell.append(b, el('span', '', u[1])); units[u[0]] = { cell: cell, b: b }; row.appendChild(cell);
        });
        card.appendChild(row);
        note = el('p', 'mfm-note'); note.hidden = true; card.appendChild(note);
      }
    }
    card.appendChild(el('p', 'mfm-foot', 'Your wallet and your tokens are not affected. This page checks by itself and opens again when we are back.'));
    ov.appendChild(card); document.body.appendChild(ov);

    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    function tick() {
      if (!units) return;
      var left = Math.floor((untilMs - (Date.now() + skew)) / 1000);
      if (left <= 0) { Object.keys(units).forEach(function (k) { units[k].b.textContent = '00'; }); units.d.cell.hidden = true; note.hidden = false; note.textContent = 'Any moment now…'; return; }
      var d = Math.floor(left / 86400), h2 = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      units.d.cell.hidden = d === 0;
      units.d.b.textContent = String(d); units.h.b.textContent = pad(h2); units.m.b.textContent = pad(m); units.s.b.textContent = pad(s);
    }
    if (units) { tick(); setInterval(tick, 1000); }

    // when the admin switches maintenance off, open the site again without anyone pressing refresh
    setInterval(function () {
      fetch('/fees-config.js?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (t) { if (t.indexOf('"mode":"maintenance"') < 0) location.reload(); })
        .catch(function () { /* offline: try again next time */ });
    }, 30000);
  }
})();
