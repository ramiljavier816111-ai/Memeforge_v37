# MemeForge

Solana token creator + admin dashboard (SQLite, zero dependencies).

**v1.17: e-mail alerts can be sent with Resend** (HTTPS API key), for hosts that block SMTP such as Railway Free / Hobby (admin → Email alerts → Send with).

**v1.16: Limits has its own tab** (admin → Limits), and the daily cap has an on/off switch (off = unlimited; the number is kept).

**v1.15: daily token cap + editable limits.**

**v1.14: underpaid flag + hosting limits.** Tokens whose fee did not reach your revenue wallet are marked "Underpaid" in admin → Tokens; free IPFS hosting is limited per order and per wallet, and only wallets that can pay get it (admin → IPFS hosting).

**v1.13: e-mail alerts** when a fee reaches your revenue wallet (admin → Email alerts).

**v1.12: one-step payment.** The visitor pays once with one wallet approval: the service fee travels inside the token-creation transaction and the total is exactly the price (see DOCS.md → "What's new in 1.12").

    node server.js        # needs Node 22.13+, no npm install

- Site:   http://localhost:3000
- Admin:  http://localhost:3000/admin   (first password `12345`, change it right away)
- Tests:  `npm test`

**Full guide (how to run, how the code works, payments, database manager): [DOCS.md](DOCS.md)**
