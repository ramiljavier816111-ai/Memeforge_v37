/* index.js  —  landing page logic (year, network tag, Connect button, ticker, background). */
  document.getElementById('yr').textContent = new Date().getFullYear();

  /* show the network chosen in the admin dashboard */
  (function () {
    var dev = ((window.MEMEFORGE_CONFIG || {}).network) === 'devnet';
    document.getElementById('netTag').textContent = dev ? 'Solana · Devnet playground' : 'Solana · Mainnet';
    document.getElementById('netFaq').textContent = dev
      ? 'The creator is currently set up for Devnet, which uses free test SOL. Devnet tokens have no real value.'
      : 'Yes. The creator is on Solana Mainnet, so it uses real SOL. Check the fee receipt before you approve.';
    document.getElementById('netExplorer').href = 'https://explorer.solana.com/' + (dev ? '?cluster=devnet' : '');
    document.getElementById('netExplorer').textContent = dev ? 'Devnet Explorer' : 'Explorer';
  })();

  /* top-right button: "Connect" until a wallet is connected. The wallet itself connects on the token creator page,
     so the button opens it with the wallet list ready; once connected there, it shows the short address instead. */
  (function () {
    var a = document.getElementById('navConnect'); if (!a) return;
    var w = null; try { w = JSON.parse(localStorage.getItem('mf_wallet') || 'null'); } catch (e) { /* private mode */ }
    if (w && typeof w.a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.a)) {
      a.textContent = w.a.slice(0, 4) + '…' + w.a.slice(-4);
      a.href = 'solana-token-creator.html';
      a.title = 'Wallet connected. Open the token creator';
      a.classList.add('is-connected');
    }
  })();

  /* ticker */
  const words = ['Launch it','Mint it','Revoke it','Pair it','Ship it','Send it','Number go up'];
  const t = document.getElementById('ticker');
  const row = words.map(w => `<span>${w}</span>`).join('');
  t.innerHTML = row + row + row + row; // repeated so the -50% loop is seamless

  /* floating memecoin background: coins + emoji */
  (function(){
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bg = document.getElementById('bg');
    const small = innerWidth < 700;
    const emoji = ['🚀','💎','🌕','🔥','💰','🪙','✨','🍌','⚡','🎉'];
    const n = small ? 14 : 28;
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const isCoin = i % 3 === 0;
      const el = document.createElement('div');
      const size = isCoin ? rnd(26, 62) : rnd(22, 46);
      el.style.left = rnd(0, 100) + 'vw';
      el.style.animationDuration = rnd(16, 38) + 's';
      el.style.animationDelay = (-rnd(0, 38)) + 's';
      el.style.setProperty('--dx', rnd(-18, 18) + 'vw');
      el.style.setProperty('--rot', (Math.random() < .5 ? -1 : 1) * rnd(180, 540) + 'deg');
      el.style.opacity = rnd(.28, .7);
      if (isCoin) {
        el.className = 'coin-bg';
        el.style.width = el.style.height = size + 'px';
        el.style.fontSize = size * .5 + 'px';
        el.textContent = '$';
      } else {
        el.className = 'float';
        el.style.fontSize = size + 'px';
        el.textContent = emoji[Math.floor(Math.random() * emoji.length)];
      }
      bg.appendChild(el);
    }
  })();
