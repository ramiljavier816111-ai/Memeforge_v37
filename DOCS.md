# MemeForge: how to run it and how it works

MemeForge is a Solana token-creator website with an admin dashboard. Visitors connect a wallet and create a token in one transaction. A fee goes to your wallet inside that same transaction. You manage prices, wallet, logo and the database from `/admin`.

---

> **v1.12 · ONE-STEP PAYMENT.** The visitor pays **once**, with **one approval** in the wallet. The service fee travels inside the token-creation transaction again (section 5 describes exactly that), and the total is exactly the price on the receipt. The separate "pay first" payment of v1.11 is gone; see "What's new in 1.12" at the end of this file.

## 1. Run it

**You need:** [Node.js](https://nodejs.org) **22.13 or newer**. Check with `node --version`.
There is **no `npm install`**. The project has zero dependencies (it uses Node's built-in SQLite).

```bash
cd memeforge
node server.js            # or:  npm start
```

| What | Address |
|---|---|
| Public site | http://localhost:3000 |
| Token creator | http://localhost:3000/solana-token-creator.html |
| Admin dashboard | http://localhost:3000/admin |

**First login:** password `12345`. The dashboard sends you straight to **Security** so you can change it. Do this before putting the site online.

The database is created for you at `data/memeforge.db`.

### Settings via environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `DB_FILE` | `data/memeforge.db` | Where the database file lives |
| `TRUST_PROXY` | off | Set to `1` when behind nginx / Cloudflare so rate limits use the visitor's real IP |

Example: `PORT=8080 TRUST_PROXY=1 node server.js`

### Putting it online
1. **Use HTTPS.** Mobile wallets only work on https sites. Put nginx, Caddy or Cloudflare in front and set `TRUST_PROXY=1`.
2. **Keep it running** with a process manager, e.g. `pm2 start server.js --name memeforge`.
3. **Back up `data/memeforge.db`** (or use the dashboard's *Download backup* button, section 3.4).
4. In the dashboard, set the **network** (devnet to test, mainnet for real money), your **revenue wallet**, and ideally your own **RPC URL** (Helius / QuickNode / Alchemy). The free public RPC is rate-limited.

### Run the tests
```bash
npm test
```
72 tests run in a few seconds. They need no internet because Solana is simulated (see section 5.4).

---

## 2. What changed in this version

| Request | What you got |
|---|---|
| More modern admin login | New split-screen login: show/hide password, Caps Lock warning, loading spinner, shake on wrong password, mobile layout, lockout message with minutes left. First login with the default password jumps to Security. |
| Upload logo for admin | **Settings → Branding**. Drag & drop or pick a PNG/JPG/GIF/WebP up to 1 MB, preview, upload, remove. Shown on the login page, the sidebar and the browser tab icon. |
| phpMyAdmin-style DB monitoring | New **Database** page (section 3.4). |
| Documentation | This file. |
| Check that payments work | Section 5, plus automated tests. |

**Why not real phpMyAdmin?** phpMyAdmin only works with MySQL/MariaDB. This project uses SQLite (a single file, nothing to install). Adding MySQL just for monitoring would add a server to maintain and secure. The built-in Database page does the jobs you need: watch the size, look inside tables, free space safely. If you ever want to open the raw file in a desktop tool, [DB Browser for SQLite](https://sqlitebrowser.org) can open a backup.

Also fixed: `package.json` listed `express` and `better-sqlite3`, which the code never used. It now lists no dependencies and requires Node 22.13+. (On older Node, `node:sqlite` is missing or needs a flag.)

---

## 2b. New: wallet reports, wallet list, toasts and progress bars

- **Reports page** now has, for the selected network: new wallets per day, what creators **spent**, the **fee sent to MemeForge**, and the **network cost** (rent + fees that stay with Solana). Below the daily table are two searchable lists with CSV export: **Visitor wallets** (address, app, first/last seen, connects, tokens, spent, fee) and **Tokens created** (token name + symbol read from the chain, mint, creator wallet, app, features, spent, fee, network, transaction link).
- Spent/fee/network are computed by the server from the verified transaction (creator's balance drop, fee wallet's balance rise). Tokens created before this update only have the fee, so their other columns show "–". The wallet app name and ticked features are reported by the browser, so treat them as informational. Wallet addresses in the list are also reported by the browser when someone connects.
- **Wallets page** controls the "Connect a wallet" popup on the token creator: add popular wallets in one click, add your own (name, **logo image link**, provider, install link, mobile link), turn wallets on/off, reorder, edit, delete. Changes show after a refresh of the creator page. If an installed wallet is not shown as "Detected", edit its **Provider** (the spot where the extension puts itself, e.g. `okxwallet.solana`). The preset providers and mobile links are the commonly documented ones; test each wallet you enable.
- **Toasts + progress:** success/error toasts across the admin and the creator. The logo upload shows a real byte-by-byte progress bar, the backup download shows download progress, optimize/delete show a busy bar, and token creation shows a 6-step progress bar with elapsed time.
- Database upgrades itself on start (new columns and the `wallets` / `wallet_options` tables); nothing is lost.

New API: `POST /api/wallet-connected` (public), `GET /api/admin/visitor-wallets`, `/tokens` (+ `.csv`), `GET/POST/PUT/DELETE /api/admin/wallet-options`, `POST /api/admin/wallet-options/reorder`.

---

## 2c. Latest changes

- **Token creator:** the wallet popup shows 4 wallets; with more, a "Show N more wallets" button reveals the rest (detected wallets are always listed first).
- **Admin navigation:** logo upload moved to its own **Branding** tab; **Pricing & network** (network, revenue wallet, SOL fees) is the old Settings page.
- **Overview:** a **live table** of the newest token creators (when, creator wallet, token, app, spent, fee, tx). It refreshes every 5 seconds while the Overview is open, highlights new rows and shows a toast.

---

## 2d. Latest changes (v1.5)

- **Popular wallets are editable.** In **Wallets**, tap the **★ star** on any wallet (or tick *Mark as Popular* when editing) to give it a **Popular** badge. On the token creator, the popup lists wallets the visitor has installed first, then your Popular wallets, then the rest (your own order is kept inside each group). Use the *All / ★ Popular / Hidden* filter to review them. Only **Phantom** and **Solflare** have the badge by default; every other wallet (including ones added from the catalog) starts without it and you can turn it on with the ★ star. The old "Popular wallets" catalog card is now called **Wallet catalog**.
- **Every price defaults to 0.1 SOL** (creation fee and all six extras) on new installs. Databases that already have saved prices keep them; in **Pricing & network** press **Set every price to 0.1 SOL**, then **Save changes**.
  Note: the network cost of a token is about 0.009 SOL, so with a 0.1 base price about 0.09 SOL of every token is yours, and each ticked extra adds its own 0.1 SOL to your wallet.
- **New Appearance page** (admin menu, under Manage). Live-previewed, saved only with *Save look*, stored on the server so it follows you to every device: 8 one-click looks; dark / light / auto; main + second colour (swatches or any hex) and gradient on/off; font, text size, corner roundness, spacing; menu style (glass / solid / tinted), active-item style, slim menu on start, page width; card style, background, blur, striped tables, animations; dashboard name + tagline; copy / load a theme code; reset. Files: `public/admin-theme.js` (engine), the *THEME ENGINE* block at the end of `admin.html`'s CSS, API `GET/PUT/DELETE /api/admin/theme`.

---

## 3. Using the admin dashboard

### 3.1 Login and security
- Passwords are stored as a salted **scrypt** hash, never as text.
- 5 wrong passwords from one IP lock sign-in for 15 minutes. Each wrong try also waits 0.6 s.
- Sessions last 8 hours. Changing the password signs out every other session.
- The login cookie is `HttpOnly` and `SameSite=Strict`, and changing requests are also checked against the site's own address.

### 3.2 Settings
Timezone (decides when a "day" starts), RPC URL and revenue wallet per network, creation fee and each premium feature price (in SOL). Saving applies instantly. Visitors only need to refresh. This page only edits: which network visitors use is chosen in **Site mode** (3.2b).

### 3.2b Site mode
One switch for the whole site: **Mainnet**, **Devnet**, **Dry run** or **Maintenance** (see "What's new in 1.8" below). Nothing is stored until you press **Save changes**; switching to Mainnet or to Maintenance asks you to confirm.

### 3.3 Branding / logo
Upload under **Settings → Branding**. The server checks the file's real contents (not the name or type the browser claims), rejects anything over 1 MB, and **refuses SVG** because SVG files can contain scripts. The logo is stored in the database and also served publicly at `/logo` if you want to use it on your site.

### 3.4 Database page (the "phpMyAdmin")

**Health card:** shows the file size against your **size limit** (default 100 MB, change it any time). Status is *Healthy* below 80%, *Getting full* from 80%, *Over limit* at 100%. When it is not healthy you get a banner on every page and a dot on the sidebar item.

**Buttons**
- **Download backup:** a consistent copy of the whole database, safe to take while the site runs. Do this before deleting anything.
- **Optimize (shrink file):** deleting rows frees space *inside* the file but the file stays the same size until you optimize. This hands the space back to the disk.
- **Refresh**

**Tables card:** every table with its row count and size. Click *Browse / clean* to open one (25 rows per page, newest first).

**What you can delete**

| Table | Holds | Can delete | Notes |
|---|---|---|---|
| `visits` | one row per visitor per day | rows older than N days | This is the table that grows fastest. Each day's visitor total is **saved first**, so your report history stays. Today is never touched. |
| `tokens` | one row per token created | selected rows, or older than N days | Revenue totals in the report are **kept**. |
| `daily_stats` | the daily revenue/token report | selected rows, or older than N days | Removes that history from the report. Back up first. |
| `daily_visitors` | saved totals of purged days | selected rows, or older than N days | Removes that history from the report. |
| `fees`, `settings` | prices and configuration | **never** | View only. Edit them in Settings. (The password hash is hidden.) |

**Deleting is deliberately careful:** you pick days (0 = everything before today), the server counts exactly how many rows match, and a confirm box shows that number before anything is removed. "Shrink the file afterwards" is ticked by default.

**Typical clean-up when the DB is getting full:** Database → *Download backup* → open `visits` → "older than 30 days" → *Delete old rows* (with shrink ticked).

---

## 4. How the code works

### 4.1 File map

```
memeforge/
├─ server.js                 the whole backend (one file, no dependencies)
├─ package.json              no dependencies; "npm start", "npm test"
├─ DOCS.md                   this file
├─ data/memeforge.db         created on first run (the database)
├─ test/
│   ├─ payments.test.js      tests for payment.js
│   └─ server.test.js        tests for server.js (verification, logo, DB manager)
└─ public/                   everything the browser loads
    ├─ index.html            landing page
    ├─ solana-token-creator.html   the creator (wallet, form, builds the transaction)
    ├─ payment.js            fee maths + fee transfer + on-chain fee check
    ├─ track.js              counts a visitor once per day
    ├─ seasonal.js           seasonal theme + special-offer banner (landing page and creator)
    ├─ site-mode.js          maintenance page + dry-run strip (landing page and creator)
    ├─ admin-theme.js        admin look & feel engine (Appearance page)
    ├─ admin.html            admin dashboard layout + styles
    └─ admin.js              admin dashboard behaviour
```

### 4.2 server.js, section by section

1. **Database.** Opens `data/memeforge.db` (SQLite, WAL mode) and creates the tables if missing. First-run defaults are inserted with `INSERT OR IGNORE`, so restarting never overwrites what you saved.
2. **Password.** `hashPassword` / `checkPassword` use scrypt with a random salt; comparison is constant-time.
3. **Helpers.** Date in your timezone (`dayOf`), cookies, JSON body reader with size limits, a tiny in-memory rate limiter.
4. **Admin sessions.** A random token in a cookie maps to an expiry time in memory. `requireAdmin()` guards every `/api/admin/*` route.
5. **Blockchain check.** `verifyCreationTx` asks the Solana RPC for the transaction and works out what really happened (section 5.3).
6. **Report.** `buildReport` fills in every day of the range, then adds visitors, tokens and revenue.
7. **Logo upload.** `sniffImage` / `saveLogo` (section 3.3).
8. **Database manager.** `dbOverview`, `browseTable`, `deleteRows`, `optimizeDb`, `makeBackup`.
9. **Routes.** One function, `handleApi`, matches the URL and method.
10. **Static files.** Serves `/public` only. Path tricks like `../` are blocked and dotfiles are hidden. The admin page also gets a strict Content-Security-Policy.

### 4.3 Database tables

| Table | Purpose |
|---|---|
| `settings` | network, rpc_url, fee_wallet, timezone, db_limit_mb, admin password hash |
| `fees` | creation fee + each premium feature price (SOL) |
| `visits` | `(day, visitor)`; the primary key makes a visitor count once per day. Random cookie id, **no IP stored** |
| `tokens` | each created token; `signature` is `UNIQUE`, so one transaction can never be counted twice |
| `daily_stats` | per day and network: tokens and revenue (devnet and mainnet never mix) |
| `daily_visitors` | visitor totals of days whose `visits` rows were purged |
| `assets` | the uploaded logo (image bytes) |

### 4.4 API

**Public**

| Method & path | What it does |
|---|---|
| `GET /fees-config.js` | Generated from the database. Gives the pages `window.MEMEFORGE_CONFIG` (network, wallet, prices). |
| `GET /logo` | The uploaded logo (404 if none). |
| `POST /api/visit` | Counts this visitor for today (bots ignored, 60/hour/IP). |
| `POST /api/token-created` | `{signature, mint}`: verifies on-chain, then records (20/hour/IP). |

**Admin** (need login)

| Method & path | What it does |
|---|---|
| `POST /api/admin/login`, `/logout`, `GET /me` | Session |
| `GET/PUT /api/admin/settings` | Read / save wallet, RPC, timezone, fees per network (the network itself is chosen with `/api/admin/mode`) |
| `GET/PUT /api/admin/mode` | Site mode: `{mode, dryRun:{network,table}, maintenance:{title,message,until,countdown}}`. Every part is optional on save; all-or-nothing. |
| `GET/PUT /api/admin/ipfs` | Read / save the Pinata key (JWT) and the image link prefix. The key is never returned, only `configured` and the last 4 characters |
| `POST /api/admin/ipfs/test` | Ask Pinata whether the saved key is accepted |
| `POST /api/admin/ipfs/sample` | Upload a sample picture (or the admin's own `{image: dataUrl}`) plus a tiny metadata file |
| `GET /api/admin/ipfs/log` | Paged table of every upload made with the key (newest 1,000 kept) |
| `POST /api/upload-metadata` | Public: pins the visitor's logo, banner and details to IPFS and returns the metadata link. Off without a key, refused during Maintenance and Dry run, limited to 12 per hour per visitor |
| `POST /api/admin/password` | Change password |
| `GET /api/admin/stats`, `/report.csv` | Daily report, CSV export |
| `POST/DELETE /api/admin/logo` | Upload / remove logo |
| `GET /api/admin/db` | Size, limit, status, all tables |
| `GET /api/admin/db/table?name=&page=` | Browse a table |
| `POST /api/admin/db/delete` | Delete rows (`dryRun` counts only) |
| `POST /api/admin/db/optimize` | Shrink the file |
| `PUT /api/admin/db/limit` | Set the size limit |
| `GET /api/admin/db/backup` | Download a backup |

### 4.5 Admin front end
`admin.html` holds the layout, styles and an icon sprite. `admin.js` calls the API and draws results. It writes everything with `textContent` / DOM nodes (never `innerHTML` with data), so nothing stored in the database can run as a script in your dashboard.

---

## 5. The payment system

### 5.1 How the money flows
When a visitor creates a token, **one** transaction does everything: create the mint, add metadata, mint the supply, revoke authorities if ticked, and **send your fee**.

`payment.js` computes the amounts:

```
features = creationFee + every premium feature the user ticked
network  = real Solana cost: rent for mint + metadata + token account + signature fee
toOwner  = max(features - network, 0)      ← sent to YOUR wallet
total    = network + toOwner               ← what the user pays in total
```

So the **price the user sees is the fee you set**; the unavoidable Solana cost is taken out of it, and the rest is yours. Example with default prices:

| | Lamports | SOL |
|---|---|---|
| Creation fee only | 100,000,000 | 0.1 |
| Network cost (with supply) | ≈ 9,127,600 | ≈ 0.0091 |
| **You receive** | ≈ 90,872,400 | **≈ 0.0909** |
| All features ticked (0.7 SOL) → you receive | ≈ 690,872,400 | ≈ 0.6909 |

Rent amounts are refreshed from the RPC when the page loads so the receipt is accurate. If your fees are lower than the network cost, `toOwner` is 0 and the user only pays the network cost.

### 5.2 Step by step (creator page)
1. The page loads `/fees-config.js` (your current prices) and `payment.js`.
2. The receipt on screen is drawn from `computeFees()`.
3. On "Create token": `buildFeeInstruction()` makes a `SystemProgram.transfer` to your wallet (and refuses if your wallet address is missing or invalid), and `assertCanAfford()` checks the balance.
4. The wallet signs one transaction containing all instructions. It is **atomic**: the token is created *and* you are paid, or nothing happens.
5. After confirmation, `verifyFeeDelivered()` reads the transaction back and confirms your wallet's balance rose by at least `toOwner`.
6. The page posts `{signature, mint}` to `/api/token-created`.

### 5.3 How the server counts revenue (so numbers can't be faked)
`/api/token-created` never trusts the browser's numbers. It fetches the transaction from the chain and checks that it:
- succeeded,
- touches the reported mint, the Token program **and** the Metaplex metadata program (so it really is a token creation),
- is less than 30 minutes old,
- is a signature not already recorded.

**Revenue = how much your wallet's balance actually rose in that transaction.** If the creator is your own wallet (you testing), the transfer nets to zero, so revenue is recorded as 0. Saving the token and adding to the daily report happen in one all-or-nothing SQL transaction.

### 5.4 Is it tested?

**Yes, with the limits below.** `npm test` checks:
- the fee maths (base fee, all features, rounding of prices like 0.1 + 0.2, no-supply case, fees lower than network cost),
- the transfer instruction (right sender, your wallet, exact amount, refuses a bad wallet),
- the balance check and the on-chain fee check (success, too little, failed transaction, RPC lag retries),
- server verification with simulated Solana responses: a real creation is counted with the correct revenue; duplicates are not double counted; non-creation, failed and old transactions are rejected; devnet and mainnet are kept apart.

**What these tests cannot prove:** they use a simulated blockchain. They do not click through a real wallet. **Before going live, do one full run on devnet** (Settings → Devnet, create a token with a funded devnet wallet, confirm the Revenue today figure rises). Then switch to mainnet.

### 5.5 Good to know
- **The fee is enforced by your website's code.** Someone technical could skip your site and create tokens with their own script; they'd just not be your customer. If you ever need payment to be impossible to skip, it requires a server-side or on-chain design (e.g. the server builds and co-signs the transaction), which is a bigger change.
- A new transaction is only accepted within 30 minutes of creation. If you delete a `tokens` row, that signature could theoretically be re-submitted only inside that window.
- If you test with your own fee wallet as the creator, revenue shows 0 (explained above). Use a different wallet to see revenue.
- Everything the server does is synchronous SQLite, which is fast for this workload. Very large deletes or *Optimize* on a huge database can briefly pause the site, so run them at quiet times.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module 'node:sqlite'` | Your Node is too old. Install Node 22.13+. |
| Locked out of admin | Wait 15 minutes. Forgot the password? Stop the server and run:<br>`node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/memeforge.db');d.exec(\"DELETE FROM settings WHERE key IN ('admin_pass_hash','admin_pass_default')\")"`<br>then start again. The password resets to `12345`, so change it at once. |
| Wallet doesn't connect on phone | The site needs HTTPS. |
| Token created but Revenue stays 0 | Wrong network selected in Settings, creator wallet equals your fee wallet, or the RPC was too slow (check the server console). A free public RPC often fails; use your own RPC URL. |
| Database page says "Over limit" | Section 3.4: backup, delete old `visits`, optimize. Or raise the limit if you have disk space. |
| Logo not changing | Hard refresh (Ctrl+F5). The browser may have cached the old one. |
| Dashboard shows `Please log in again` | The session expired (8 h) or the server restarted. Sessions live in memory. |


---

## What's new in 1.2

**Live Overview.** The Overview page refreshes itself every 4 seconds from one endpoint (`GET /api/admin/live`): today's stats, lifetime totals, wallets, the database meter and the newest tokens. A "Live" pill in the top bar shows the last update. The Reports page also refreshes while it shows the latest days. Updates pause when the browser tab is hidden.

**Daily report.** Shows 7 days by default (also 14 / 30 / 90). **‹ Previous** and **Next ›** move one window at a time, **Today** jumps back. API: `GET /api/admin/stats?days=7&offset=0` (`offset` = days back the window ends). The CSV export follows the same window. Reports now has tabs: Daily report, Visitor wallets, Tokens created.

**Admin design.** New calm slate theme, sidebar grouped into Dashboard / Manage / System.

**Wallets.**
- The token creator's "Connect a wallet" popup has a **search box** and a scrollable list, so any number of wallets works.
- `wallet-presets.js` is the catalog: 136 wallets in categories (Popular, Solana, Multi-chain, Browser, Exchange, Hardware, Embedded). Admin → Wallets → *Popular wallets* has search, category filters, one-click add and "Add all shown".
- New and upgraded databases get the 11 top wallets once (existing choices are never overwritten; deleting one is not undone). The limit is now 300 wallets.
- Only wallets with a **Provider** can connect; the others show an install link. Providers other than the original 11 are best-known values and are not tested against every wallet version: if a wallet is installed but not "Detected", fix its Provider in Wallets → Edit.


---

## What's new in 1.3

**Modern admin.** Animated aurora background, glass cards, gradient accents and a redesigned login screen.

**Collapsible menu (desktop).** The button at the top-left of the top bar (or the `[` key) switches the sidebar between full and a slim icon rail with hover labels. The choice is remembered in the browser. On phones the menu still slides in over the page.

**Separate RPC and revenue wallet per network.** Admin → Pricing & network now has an *Active network* picker (Mainnet / Devnet) and one card per network, each with its own **RPC endpoint** and **revenue wallet**. The site uses the values of the active network: the public `fees-config.js` (`rpcUrl`, `feeWallet`), the on-chain verification of created tokens, and which wallet counts as revenue. Databases from 1.2 or older are migrated automatically on first start (the old RPC stays with the network that was active, the old wallet is copied to both). API: `PUT /api/admin/settings` takes `rpcUrls` and `feeWallets` as `{ "mainnet-beta": …, "devnet": … }`; an old-style single `rpcUrl` / `feeWallet` still works and applies to the active network.


---

## What's new in 1.4

**Responsive everywhere.** The admin was checked in a real browser at phone (360 px), phone landscape, tablet, laptop and desktop sizes: no sideways page scrolling and no script errors. Highlights: the menu is a slide-in drawer on phones/tablets and starts as the slim icon menu on tablets; stat cards go 4 → 2 columns; wide tables scroll sideways inside their card with a soft edge hint; buttons and fields get bigger tap targets on touch screens (and 16 px text so iPhones don't zoom in); the top bar shortens its labels on small screens; the login card stays reachable on short screens; the bottom bar respects phone safe areas. The public token creator got small fixes for very small and very short screens.

**Pricing & network, explained step by step.**
- A summary at the top always shows: which network visitors use, where fees are sent, and what a token costs (from base price up to the price with every extra).
- Step 1: choose the network (tags show what is live now and what will change when you save) and the reports timezone.
- Step 2: for each network, the connection (RPC) and the revenue wallet, each with a plain-English explanation, live validation, "Use free" and "Same as mainnet" shortcuts, and a **Test connection** button. The test runs in your browser: it checks the connection really is that network (a mainnet address in the devnet box is caught) and shows the wallet's balance.
- Step 3: prices grouped as Base price, Optional extras and Safety locks, each with a one-line description, a SOL unit and a "Free" tag at 0.
- A save bar shows "All changes saved" or "You have unsaved changes" with Save and Discard. Saving asks for confirmation only when it matters (switching to mainnet, or changing the wallet that receives fees).

- **Solana wallets only.** The token creator refuses any wallet whose address is not a real Solana address (base58 text that decodes to exactly 32 bytes), so Ethereum (`0x...`) or Bitcoin addresses cannot connect. The browser checks it on connect/account change, and the server checks it again on `/api/wallet-connected`.


---

## What's new in 1.7: seasonal themes and special offers

Admin → **Themes & offers**. Everything is edited in the dashboard and goes live when you press **Save** (visitors see it after a refresh). Nothing changes on the site until you switch something on.

**Special offer** (step 1)
- A discount of 0–90 % with a title, message, optional badge, countdown, and an optional button. Choose where it shows (landing page, token creator, or both).
- It applies to the creation fee, the extras, or both (*Applies to*), only between **Starts** and **Ends** (empty start = right away, empty end = until you switch it off). Times use the reports timezone from Pricing & network.
- The discount is applied **on the server** to the prices in `/fees-config.js`, so the receipt, the *Create token* button and the fee that is really sent in the transaction always agree. The creator receipt shows the old price crossed out and a *You save …* line. Your real prices in **Pricing & network** are never changed, and the revenue in the reports is still measured from the chain.
- The Solana network cost of a token (about 0.0091 SOL) is never discounted. If a discounted creation fee falls below it, you earn nothing on that token. The admin warns you in the price table.
- A status pill shows *Off / Scheduled / Live now / Ended*. After the end time, the countdown on an open page changes to “offer ended, refresh”.

**Seasonal theme** (steps 2–3)
- 8 themes: Christmas, New Year, Valentine's, Easter, Summer, Halloween, Black Friday and a **Custom** one. Each one recolours the landing page and the creator (7 colours), swaps the floating background for its own emoji (rise, fall, or still; few / normal / lots; optional $ coins), can show a string of lights and a greeting banner.
- Tap a theme to edit its colours, emoji, motion and banner text, with a live preview. *Reset this theme* brings back the original.
- **Show a theme:** *Never* (normal look), *Always* (the theme you pick) or *Automatically*: every theme has a yearly date window (month and day, reports timezone; a window may wrap over New Year). If windows overlap, the theme higher in the list wins. Easter moves every year, so it is off by default: set its dates.
- People who prefer reduced motion see still pictures instead of moving emoji. Visitors can close the offer bar (it stays closed for that browser session).

**How it works / files**
- `server.js`: section *SEASONAL THEMES + SPECIAL OFFER*. Stored as one JSON setting (`site_promo`); every value is validated (colours must be `#rrggbb`, links must be a page of this site or `https://`, dates must be real). `/fees-config.js` now also carries `window.MEMEFORGE_CONFIG.promo` (`theme`, `offer`).
- `public/seasonal.js`: loaded after `fees-config.js` on both public pages. Draws everything with `textContent` and CSS variables, never `innerHTML`.
- API (admin): `GET / PUT / DELETE /api/admin/promo`.
- 8 new tests cover login protection, discount maths and rounding, start/end/timezone handling, validation, themes, edits, schedule (including the New Year wrap) and the pages loading `seasonal.js`.

## What's new in 1.8: site modes, wallet menu and the "token created" card

**Admin → Site mode** (new tab). One switch with four positions, saved in the settings table (`site_mode`):

| Mode | What visitors get |
|---|---|
| **Mainnet** | Real tokens, real SOL. |
| **Devnet** | Real practice tokens, free test SOL. |
| **Dry run** | The creator builds the whole transaction and asks Solana to *simulate* it. Nothing is signed, sent, paid or recorded. Visitors see what would happen. |
| **Maintenance** | A friendly full-screen page with your title, message and an optional date, time and countdown (shown in each visitor's own local time). The creator is switched off. The page opens the site again by itself when you switch maintenance off. |

- **Pricing & network** no longer has the network picker. It only edits (timezone, RPC, revenue wallet, prices) and shows the current mode with a link to Site mode. A `network` sent to `PUT /api/admin/settings` is ignored on purpose.
- The `network` setting still means "the network the site uses right now": Devnet/Mainnet set it, a Dry run uses its own *Dry run reads prices from* network, and Maintenance leaves it unchanged. Reports, RPC checks and fee wallets therefore keep working as before.
- **Dry run table**: Site mode → *Show the dry-run table*. On: every step with its cost, the total, the visitor's balance and the simulation result (a failing step is marked and later steps say "not reached"). Off: only the total and whether it would succeed.
- Existing installs start in the mode that matches their current network.
- `/fees-config.js` now also carries `mode`, `dryRun` (`{table}` only during a dry run) and `maintenance` (only during maintenance). `public/site-mode.js` draws it with `textContent` only.

**Landing page**: the top-right button is **Connect** (opens the token creator with the wallet list ready). Once a wallet is connected on the creator it shows the short address instead.

**Token creator**
- The **Create token** button reads **Connect Wallet** while no wallet is connected and opens the wallet list.
- Top right: the **wallet logo** sits left of the address. Click it for a menu with the wallet name, balance, the address with a **Copy** button, the **recent transactions** of that wallet on the current network (from the RPC, each opens Solscan), a link to all activity, and **Disconnect**.
- After a token is created a **modal card** shows the ticker, logo and banner, supply and decimals, the token address with **Copy**, **Solscan** and **Raydium** buttons, and the features that were selected. The details stay on the page after it is closed.

**Tests**: 5 new server tests (login protection, default mode, devnet/mainnet switching, dry-run table switch, maintenance date/time and validation) plus static checks for the new files. The browser flows were also checked in a real headless browser (wallet menu, Connect Wallet, dry run with the table on/off and with failures, the created card, the maintenance page and the admin tab).

## What's new in 1.10: site modes + IPFS hosting together

This version merges v17 (IPFS hosting with a Pinata key) and v18 (site modes, wallet menu and the "token created" card, which had IPFS taken out). Everything from both is in.

**IPFS hosting (admin → IPFS hosting).** Paste a Pinata API key (JWT). It is stored in the database, hidden in the database manager, and never sent to a browser. The key field has a show / hide eye and, once saved, shows `Saved key: ••••` plus its last 4 characters. With a key set, the token creator hosts each token's logo, banner and `metadata.json` on IPFS by itself when the visitor presses Create, and fills in the Metadata URI. A visitor who pastes their own link keeps it. The same page has **Test key**, **Test with a sample image** (upload or drop your own logo, or use the built-in picture) and a table of every upload. Images must be PNG, JPG, GIF or WebP up to 2 MB (SVG cannot be hosted, so the creator does not offer it).

**How it works together with Site mode**
- **Mainnet / Devnet**: IPFS hosting works as before on whichever network is live.
- **Dry run**: nothing is uploaded to Pinata. The simulation uses a stand-in link of the right length and the log says so.
- **Maintenance**: the upload endpoint is closed along with the creator.
- The wallet menu and the "token created" card work the same with or without IPFS.

**Tests**: 62 in total (all of v18's, v17's IPFS test, and one new test proving Pinata is never contacted during a dry run or maintenance).



---

## What's new in 1.11: PAY FIRST

**The new order for every live token (Devnet / Mainnet):**

| Step | What happens | Who checks it |
|---|---|---|
| 1. Details | The page checks name, symbol and supply. There is no "not enough SOL" pre-check any more: a visitor with too little SOL gets their wallet's own error (if that happens after paying, the payment is kept and they continue after topping up). | page |
| 2. Pay | The page asks the server for a **quote** (`POST /api/payment/quote`). The server works the price out itself from your prices, active special offer and the ticked features. The visitor approves **one payment** in their wallet: service fee → your revenue wallet, with the order id in a memo. | server sets the price |
| 3. Verified | The page sends the payment signature (`POST /api/payment/confirm`). The server reads the transaction from the chain and checks: it succeeded; it came from the wallet that asked for the quote; it carries **this order's memo**; it sent at least the quoted amount **to your revenue wallet** and your wallet's balance really rose. Only then is the order *paid* and the money added to the daily report. | server, on-chain |
| 4. Host | IPFS hosting (`/api/upload-metadata`) now **refuses (HTTP 402)** unless it is given a paid order. Same details twice = one upload; at most 5 hosting runs per payment. | server |
| 5. Create | The token-creation transaction no longer contains the fee. The visitor approves it (network cost only). | wallet |
| 6. Record | `/api/token-created` re-checks the creation on-chain, then **uses up** the order (one payment = one token, and only the wallet that paid can use it). | server |

**Not charged twice.** The order is remembered in the visitor's browser. If they paid but the wallet popup for step 5 was rejected, the page was closed, or the network dropped, pressing *Create token* again continues with the same paid order and no second payment. If they now ask for something that costs more than they paid (e.g. ticked more extras), a new order for the new price is made.

**Dry run** is unchanged: nothing is paid, hosted or recorded; it simulates the whole thing in one transaction including the fee. **Maintenance** refuses quotes.

**Money in the reports.** Revenue is booked **when the payment is verified** (even if the visitor never finishes creating the token), so *Revenue today* equals what really arrived in your wallet. Tokens, and the network cost they paid to Solana, are booked when the token is created. In **Reports → Tokens created**, a token made through the site shows the fee its order paid; one made without a paid order has fee 0 and no order id.

**New table `orders`** (Database page, view and delete by selecting rows). `pending` = asked for a price, not paid (auto-removed after a day); `paid` = fee verified, token not created yet; `used` = token created. The ticket secret is stored only as a hash and is hidden in the dashboard. **Do not delete `paid` rows**: those visitors paid and have not created their token.

**Testing with your own revenue wallet.** Allowed and works end to end, but earns (and books) 0, as before.

**What this does and does not stop**
- A visitor can no longer get hosting, or have a token counted as a paid creation, without a verified payment, and cannot reuse one payment twice or use another wallet's payment.
- Someone who skips your site completely and builds a token with their own code is still not stopped by anything on your server: the creation transaction itself is between their wallet and Solana. That would need the server to co-sign the creation (a bigger design). What you now control is everything that costs you money or counts in your numbers.
- The service fee is the quote **minus Solana's network cost**, exactly as before, so the visitor's total is unchanged (≈ the price you set). Solana's rent amounts are protocol constants; the server uses the same numbers as `payment.js`.

**Files:** `server.js` (section *PAY FIRST*), `public/payment.js` (`buildPaymentTransaction`), `public/solana-token-creator.html` (*PAY FIRST* block + the create button), `test/server.test.js` (9 new tests; the IPFS tests now pay first). API: `POST /api/payment/quote`, `POST /api/payment/confirm`; `/api/upload-metadata` and `/api/token-created` take `{order, secret}`.


---

## What's new in 1.12: ONE-STEP PAYMENT

**Why.** In 1.11 the visitor approved two transactions (service fee first, then the token). The wallet question also added the fee and the network cost on top of each other using different rent numbers, so the total came out at about 0.1575 SOL instead of the 0.16 SOL on the receipt.

**The new order for every live token (Devnet / Mainnet):**

| Step | What happens |
|---|---|
| 1. Details | The page checks name, symbol and supply and reads Solana's **live** rent numbers. |
| 2. Order | The page opens an order on the server (`POST /api/payment/quote`). The order is only a ticket: nothing is paid yet. |
| 3. Question (mainnet) | One confirmation: *Total 0.16 SOL, you pay once, one approval.* It shows the same total as the receipt and the Create button. |
| 4. Host | The logo, banner and details go to IPFS (`/api/upload-metadata`, which needs a valid order). |
| 5. Pay + create | **One transaction** holds the token creation and the service fee transfer to your revenue wallet. The visitor approves it **once**. |
| 6. Record | `/api/token-created` re-checks the transaction on-chain and books the revenue and the network cost **from the chain**. The order becomes `used`. |

**The total is exactly the price.** `service fee = price − network cost` (payment.js, with live rent), so `fee + network cost = price`. With a price of 0.16 SOL the visitor pays 0.16 SOL, whatever Solana's rent currently is. The receipt, the Create button, the mainnet question and the wallet popup all show that same total (the wallet may add a tiny priority fee of its own).

**What stays the same**
- Prices, special offers, revenue wallet per network, dry run (it simulates this very transaction), maintenance mode and the wallet menu.
- Visitors who already **paid under 1.11** keep their paid order in their browser: it is used first, the transaction then carries no fee, and they are never charged twice. Their `paid` rows in the `orders` table must not be deleted.

**What changed in the trade-off (please read).** Hosting now happens **before** the payment, because the logo link must be known before the transaction is built. To keep that from being abused:
- `/api/upload-metadata` still refuses anyone without a valid order from the server (HTTP 402).
- An order that is not paid yet gets at most **3** hosting runs (same details twice = one upload), an order paid under 1.11 gets 5.
- The per-visitor limits stay: 12 uploads and 40 quotes per hour per IP address.
- This is the same exposure the site had before 1.11. If a visitor hosts a logo and never pays, the pinned file costs you a little Pinata space; you can unpin it from the Pinata dashboard. The **IPFS usage** table in the admin shows every upload.

**When the wallet answers only "Error processing the transaction".** That sentence comes from the wallet (some wallets say nothing more). The page now finds the real cause before showing the error: it measures the transaction against Solana's 1232-byte limit, compares your wallet balance with what the payment needs **plus the ~0.0009 SOL Solana makes every wallet keep**, and asks Solana to simulate the transaction. The log and the toast then say which one it is (for example *Not enough SOL: this needs 0.16 SOL and your wallet has 0.1605 SOL, add at least 0.0004 SOL*). There is still no balance check **before** the wallet opens. Only if all three checks pass does the page try once more the other way (the wallet signs, the page sends); that can show a second approval, but nothing is charged by the failed first try, and the mint address is unique so a token can never be created twice. Files: `public/solana-token-creator.html` (`walletSend`, `explainSendFailure`).

**"Signature … has expired: block height exceeded" (v1.12.2).** That error does **not** prove the transaction failed. The old confirmation relied on a websocket that some RPC endpoints and browsers block, so a transaction that had gone through could still be reported as expired. Now:
- The page **polls** the network for the signature (`waitConfirmed`) instead of waiting for a websocket message. When the page itself sent the signed bytes, it re-sends them every few seconds while waiting, because a public RPC can drop a transaction silently.
- After the blockhash runs out it keeps looking for one more minute (a wallet may have used a newer blockhash than the page did). Only then does it say *not confirmed*, and the message includes the Solscan link and what to do.
- The last sent transaction is remembered in the browser (per wallet and network). On the next press of **Create token** the page checks it **first**: if it landed, the token is recorded and shown and **nothing is charged again**; if it is still in flight the page asks you to wait a minute; if it was dropped or failed, it starts fresh.
- If this keeps happening, use a better mainnet RPC (Admin → network settings) instead of the public one. Public endpoints drop transactions under load.
Files: `public/solana-token-creator.html` (`waitConfirmed`, `recoverSent`, `recordCreated`).

**Orders table.** `pending` = open order, nothing paid yet (auto-removed after a day), `paid` = paid under 1.11 and not used yet, `used` = token created (for one-step orders the row stores what that transaction really moved).

**Files:** `server.js` (section *PAY FIRST: orders, payment check, tickets*: `ticketOrder`, `recordToken`, `/api/upload-metadata`, `/api/token-created`), `public/solana-token-creator.html` (*ONE-STEP PAYMENT* block, `getTicket`, `confirmSpend`, the create button), `public/payment.js` (the unused two-step helper was removed), `test/server.test.js` (74 tests, 3 of them new).

## What's new in 1.15: DAILY TOKEN CAP + EDITABLE LIMITS

**Where:** admin → **Pricing & network** → the **Limits** card (bottom of the page). Changes apply right away.

| Setting | Default | What it does |
|---|---|---|
| **Most tokens per day** | 0 (no limit) | For the whole site. The day follows your timezone setting. When today's token count reaches it, `/api/payment/quote` refuses new orders ("Today's limit of N tokens has been reached. Please come back tomorrow.") and the creator page's button says **Sold out for today** (`dailyFull` in fees-config.js). Orders already opened can still finish, so a day can end a few tokens over. Someone who already paid an order under the old pay-first version is never blocked. |
| **Price quotes per visitor per hour** | 40 | Per IP address. |
| **Logo uploads per visitor per hour** | 12 | Per IP address. Every token with a hosted logo needs at least one, so this is the tightest limit (about 12 tokens an hour per visitor). |
| **Created tokens recorded per visitor per hour** | 20 | Per IP address. |

The admin shows "Today: X of Y tokens". Behind a proxy (Railway, nginx, Cloudflare) set `TRUST_PROXY=1`, otherwise all visitors share one IP and the per-visitor numbers apply to the whole site together. Database: three settings for the hourly numbers and `max_tokens_day`; nothing to migrate.

## What's new in 1.14: UNDERPAID FLAG + HOSTING LIMITS

**Why.** In the one-step payment the fee transfer is built in the visitor's browser, so the server cannot force it into the transaction. It can still notice, and it can stop the one thing that costs you money before payment: free IPFS hosting on your Pinata account.

**1. Underpaid flag (admin -> Tokens).** When a token is recorded, the server compares what your revenue wallet REALLY received (read from the chain) with what the order asked for (`tokens.expected_lamports`). If it is clearly less (more than 20,000 lamports + 1% short), the token gets `underpaid = 1`:
- an amber **Underpaid** badge next to the token name (hover it to see expected vs received),
- a warning line above the table with the count for the network,
- two new CSV columns: `expected_sol` and `underpaid` (YES).
Not flagged: an order paid separately by the older pay-first version (its fee was verified when it was paid), and tokens created with your own revenue wallet (testing). With no valid order, the price of the ticked features is expected. The flag changes nothing for the visitor; it is for you to look at.

**2. Hosting limits (admin -> IPFS hosting -> Free hosting limits).** Three settings, saved in the database:
- *Hosting runs per order* (default 2, was 3): the same details again never count twice.
- *Unpaid hosting runs per wallet per day* (default 6): counts the runs of this wallet's orders that did not end in a token in the last 24 hours, so opening order after order does not give free hosting. A finished token frees the wallet again.
- *Only host for wallets that have enough SOL* (default on).

**3. Balance check before hosting.** With the check on, `/api/upload-metadata` reads the wallet balance from your RPC and refuses (HTTP 402, "Your wallet has X SOL but this token needs Y SOL") when it is below the exact total the visitor will pay (service fee + network cost). A refused run is not counted. If the RPC cannot answer, the check is skipped so a hiccup never blocks a sale.

Existing databases upgrade by themselves (two new columns on `tokens`, three new settings). The old per-visitor limit (12 uploads an hour per IP) still applies on top.

## What's new in 1.13: EMAIL ALERTS ("fee received")

Every time a service fee is successfully sent to your **revenue wallet**, MemeForge can e-mail you the total.

**Where:** admin → **Email alerts** (new item in the *Manage* menu).

| Setting | What it does |
|---|---|
| **Send an e-mail for every fee received** | The ON / OFF switch. Starts OFF. |
| **Send alerts to** | Who gets the e-mail. One address, or several separated by commas (max 5). |
| **Show the SOL total converted to** | Philippine peso (PHP), US dollar (USD) or both. Uses the live SOL price (CoinGecko, cached 5 minutes). If the price cannot be loaded the e-mail says "price unavailable" and still shows the SOL total. |
| **Also e-mail for devnet** | Devnet SOL is free test money, so devnet payments do not e-mail unless you tick this. |
| **Subject / Message** | Edit the text freely. Placeholders: `{sol}` `{converted}` `{token_name}` `{token_symbol}` `{network}` `{creator}` `{signature}` `{explorer_url}` `{time}` |
| **Mail server (SMTP)** | Host, port, connection type, user name, password and optional "From" address. Gmail: `smtp.gmail.com`, port 587, STARTTLS, and an **App password**. |

Press **Send test e-mail** to check everything. Each test e-mail shows a **random SOL amount** (between 0.05 and 1 SOL), so you can see how the message looks with different totals; real fee e-mails always show the true amount that was paid. The result of the last e-mail (sent or failed, and why) is shown under the buttons.

**How it works**
- The e-mail is sent at the moment the fee is booked: when a token creation is recorded (one-step payment) or when an older pay-first order is settled. A repeated signature never sends a second e-mail.
- If you test with your own revenue wallet the fee nets to zero, so nothing is sent.
- Sending runs in the background. A mail problem can never slow down or break a payment; it is only logged and shown in admin.
- The mail password lives in the database and is never sent to a browser (the admin only sees its last 2 characters).
- No extra packages: `notify.js` contains a small SMTP client (STARTTLS / SSL), the SOL price lookup and the message templates.
- Tests: `test/notify.test.js` and the "fee-received e-mail" tests in `test/server.test.js` use a fake mail server, so no internet is needed.


## What's new in 1.16

- **Limits tab.** The limits moved out of *Pricing & network* into their own admin tab, **Limits**.
- **Daily cap on/off switch.** Turn it **off** and there is no daily limit (unlimited). The number is kept, so switching it back **on** uses it again. Turning it on needs a number from 1 to 100000.
- Sites that already had a daily cap above 0 keep it **on** after the update. The per-visitor hourly limits are unchanged and always on.
- API: `PUT /api/admin/limits` accepts `dailyOn` (true/false); `GET` returns `dailyOn`.


## What's new in 1.17

- **Send e-mail with Resend.** Admin → Email alerts → **Send with**: choose **Resend (API key)** or **SMTP**. Resend sends over HTTPS (port 443), so it works on hosts that block SMTP: Railway Free, Trial and Hobby plans block the SMTP ports (25, 465, 587), so a Gmail/SMTP setup there fails with “Could not connect to smtp.gmail.com:587”.
- **Set up Resend:** make a free account at resend.com → API Keys → create a key (starts with `re_`) → paste it in admin → set “Send alerts to” → Save → **Send test e-mail**. The key is stored in the database and never shown again.
- **From address:** the default `MemeForge <onboarding@resend.dev>` is Resend's test sender, which normally delivers only to the e-mail address the Resend account was opened with. To e-mail other people, verify your own domain in Resend and use an address on it. Check Resend's current rules and free limits on their site.
- SMTP is still there and is still the default for existing sites. Nothing else about the fee e-mail changes (message, placeholders, PHP/USD conversion, on/off switch).
- `data/` and `*.db` are listed in the new `.gitignore`, so the database is never uploaded to GitHub.
