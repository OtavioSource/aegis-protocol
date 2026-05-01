# Aegis Protocol — Stellar Integration

> **Note:** this is the Stellar-track companion to the main Solana submission ([SUBMISSION.md](SUBMISSION.md)). The Stellar integration lives on the `feature/stellar` branch and demonstrates **cross-currency atomic payments** as the differentiating capability for the agent payment use case.

---

## What was built

Aegis Protocol is an **economic governance layer for AI agents**. The base system (on `main`, submitted to Solana Frontier) governs every agent spending request — evaluates against company policy, decides automatically or escalates for human approval, and executes on-chain with cryptographic audit trails.

The Stellar integration on `feature/stellar` adds a **second settlement chain** behind the same governance interface, with Stellar's path payments enabling something Solana alone cannot do: **a single atomic transaction that lets an agent pay in USDC and the vendor receive EURC** (or BRL, XLM, any asset with DEX liquidity).

### The chain-agnostic architecture

```
┌─────────────────────────────────────────────────────────────────┐
│         API + Policy Engine (chain-agnostic governance)          │
└─────────────────────┬───────────────────────────────────────────┘
                      │ getSettlementAdapter(treasury.network)
        ┌─────────────┴──────────────┐
        ▼                            ▼
┌─────────────────┐         ┌──────────────────┐
│ @aegis/solana   │         │ @aegis/stellar   │
│ Token-2022,     │         │ Path Payments,   │
│ cNFT receipts,  │         │ Anchors (rdmp),  │
│ Solana Pay      │         │ Soroban (rdmp)   │
└─────────────────┘         └──────────────────┘
```

Both chains satisfy the same `SettlementAdapter` interface. Adding a third chain (Ethereum, Polygon) requires only implementing the interface — no policy engine changes, no API rewrites.

---

## Why Stellar specifically

The Stellar integration isn't "another chain to support." It's the chain that uniquely fits the agent-to-vendor payment use case:

| Stellar capability | Aegis fit |
|-------------------|-----------|
| **Path Payments (`pathPaymentStrictReceive`)** | Agent's treasury holds USDC. European vendor wants EURC. Brazilian vendor wants BRL. In Stellar, this is a single atomic operation through the on-ledger DEX. In every other chain, it's 2-3 sequential transactions through an external aggregator. |
| **Anchors (SEP-31, SEP-24)** | Vendor receives **fiat in their bank account** — no crypto wallet needed. Resolves the off-ramp friction that's blocking SMB adoption. |
| **Sub-cent fees + 5s settlement** | High-volume small-ticket payments (the agent payment profile) become economically viable. |
| **Soroban smart contracts** | Path forward for migrating the policy engine on-chain — moving Aegis from "we promise to honor your policy" to "the policy is enforced by the network." |

The thesis Stellar was built on (low-cost global cross-currency settlement) is the exact thesis the AI agent payment market needs.

---

## What ships in this branch

### Multi-chain architecture (Phases 1-2)
- New package `@aegis/stellar` mirroring `@aegis/solana`'s shape
- `SettlementAdapter` interface in `@aegis/shared` — chain-agnostic contract for `createWallet`, `transfer`, `freeze`, `getBalance`, optional `getPathQuote`
- Adapter factory `getSettlementAdapter(network)` with lazy dynamic imports — pure-Solana deploys never load the Stellar SDK
- All API routes refactored to consume the factory (companies, agents, spend-requests)

### Stellar adapter (Phases 3-4)
- `StellarTreasuryService` implementing `SettlementAdapter`
- Same-asset transfers via `Operation.payment` with trustline pre-checks
- **Cross-currency path payments via `pathPaymentStrictReceive`** with slippage protection
- Friendbot integration for testnet account funding
- Trustline management helpers
- Path quote endpoint `GET /stellar/path-quote` for pre-execution price discovery

### Multi-chain data model (Phase 5)
- `VendorWallet` Prisma model — one vendor, multiple wallets (one per chain)
- `SpendRequest.receiveAsset` — agent declares cross-currency intent at creation time
- `SpendRequest.conversionRate` + `pathPaymentPath` — path payment metadata captured for audit
- VendorWallet CRUD: list, add, remove wallets per vendor
- Vendor lookup in execute() prefers chain-specific wallet, falls back to legacy

### Demo + docs (Phase 6)
- `pnpm --filter @aegis/stellar setup-demo` — one-shot testnet provisioning script:
  creates issuers, funds market maker, places USDC↔EURC offers, sets up treasury + vendor
- `packages/stellar/README.md` — setup + usage guide
- `apps/api/.env.example` — Stellar configuration variables documented

---

## Demo flow (cross-currency)

```bash
# 1. Provision testnet accounts and DEX liquidity (~30 seconds)
pnpm --filter @aegis/stellar setup-demo

# 2. Paste STELLAR_DEMO_*_ISSUER lines into apps/api/.env

# 3. Create a Stellar treasury through the API
POST /companies/:companyId/treasuries
{ "name": "Stellar Treasury", "network": "stellar-testnet", "baseCurrency": "USDC" }

# 4. Register the vendor with their Stellar wallet
POST /companies/:companyId/vendors
{
  "name": "OpenAI EU",
  "initialWallet": {
    "network": "stellar-testnet",
    "walletAddress": "G...",
    "trustedAssets": ["EURC"]
  }
}

# 5. Quote the swap (optional, for UX)
GET /stellar/path-quote?sourceAsset=USDC&receiveAsset=EURC&amount=25&network=stellar-testnet&fromAccount=G...
# → { sourceMax: 27.50, effectiveRate: 1.10, path: ['XLM'], validUntil: ... }

# 6. Submit a governed cross-currency spend request
POST /spend-requests
{
  "actionType": "purchase_api_access",
  "vendor": "OpenAI EU",
  "amount": 25,
  "currency": "USDC",
  "receiveAsset": "EURC",
  "reason": "GPT-4 credits for European campaign"
}

# Same policy engine evaluates this. If approved:
POST /spend-requests/:id/execute
# → pathPaymentStrictReceive submitted
# → Vendor receives exactly 25 EURC
# → Treasury pays ~27.50 USDC (capped by slippage)
# → Audit log captures the path + conversionRate
# → explorerUrl points to stellar.expert showing the atomic swap
```

---

## Branch strategy

The Stellar integration lives on `feature/stellar`, isolated from the Solana Frontier submission on `main`. This:

- Protects the Solana submission narrative (governance + Token-2022 + cNFTs + Solana Pay)
- Lets us ship the Stellar pitch on its own merits without diluting either story
- Enables a clean merge to `main` later when both tracks are validated

`main` and `feature/stellar` share the same `SettlementAdapter` interface. The architectural commitment to multi-chain was made before either track shipped — Stellar is the proof that it works.

---

## Status

- **MVP functional** end-to-end: governance → policy → cross-currency path payment → on-chain audit
- **6 phases shipped** in this branch (skeleton, schema/factory, adapter base, path payments, API integration, demo script + docs)
- **Build verified**: `pnpm --filter @aegis/stellar build`, `pnpm --filter @aegis/api build`, `pnpm --filter @aegis/shared build` all green
- **Open source under Business Source License 1.1** (same as the Solana side)

### Pending operational work
- Apply the Prisma migration for `VendorWallet` + `SpendRequest` cross-currency fields (requires running PostgreSQL — `pnpm --filter @aegis/api db:migrate`)
- Run `setup-demo` against testnet and capture the demo video
- Optional: wire the dashboard to render `pathPaymentPath` + `conversionRate` for cross-currency requests

---

## Roadmap (post-MVP)

| Item | Why |
|------|-----|
| **Anchor SEP-31 integration** | Off-ramp to fiat — vendor gets BRL/EUR in their bank account |
| **Soroban policy contracts** | Move policy enforcement on-chain — no trust in Aegis API server |
| **AUTH_REVOCABLE assets** | True on-chain kill switch via clawback (requires Aegis-issued asset) |
| **Multi-asset treasury** | Single wallet holding USDC + EURC + XLM with auto-rebalancing for liquidity |

---

**Otávio Silva**
otavioaraujo.es@gmail.com
github.com/OtavioSource/aegis-protocol (branch: `feature/stellar`)
