# @aegis/stellar

Stellar settlement adapter for Aegis Protocol — adds **cross-currency atomic path payments** to the multi-chain governance layer.

## What this package does

Implements the chain-agnostic `SettlementAdapter` interface from `@aegis/shared` for the Stellar network. The Aegis API auto-routes to this adapter when a treasury's `network` is `stellar-testnet` or `stellar-mainnet`.

**Headline capability:** an AI agent holding USDC can pay a vendor that wants EURC (or BRL, XLM, any liquid asset) in a single atomic on-chain transaction via Stellar's native DEX. No external aggregator, no multi-tx swap orchestration, no manual settlement.

## Why Stellar fits the Aegis use case

| Stellar feature | Why it matters for AI agent payments |
|-----------------|--------------------------------------|
| **Path Payments** | Cross-currency atomic swap in a single tx via on-ledger DEX. Agent pays USDC, vendor receives EURC. |
| **Anchors (SEP-31)** | Bridge to fiat — vendor receives BRL/EUR in their bank account directly. (Roadmap, not in MVP.) |
| **Sub-cent fees** | Each tx costs ~0.00001 XLM. Viable for high-volume agent payments. |
| **5s settlement** | Median tx confirmation. Agents can complete a purchase loop in single-digit seconds. |
| **Soroban** | Future: migrate the policy engine to on-ledger contracts for trustless governance. (Roadmap.) |

## Architecture

```
apps/api → getSettlementAdapter(treasury.network) → StellarTreasuryService
                                                            │
                                                            ├─ transfer() → Operation.payment (same-asset)
                                                            │              OR pathPaymentStrictReceive (cross-currency)
                                                            ├─ getPathQuote() → Horizon /paths/strict-receive
                                                            ├─ createWallet() → Keypair.random()
                                                            ├─ freeze() → DB-level (clawback roadmap)
                                                            └─ getBalance() → Horizon /accounts
```

## Package layout

| File | Purpose |
|------|---------|
| `treasury.ts` | `StellarTreasuryService` implementing `SettlementAdapter` |
| `path-payments.ts` | `findStrictReceivePath()` + `executePathPayment()` |
| `friendbot.ts` | Testnet account funding (10k XLM each) |
| `trustlines.ts` | `establishTrustline()` + `hasTrustline()` for non-XLM assets |
| `assets.ts` | `getAsset(code, network)` resolves Asset from env-driven issuers |
| `constants.ts` | Horizon URLs, network passphrases, stellar.expert links |
| `scripts/setup-demo.ts` | One-shot script to provision the cross-currency demo on testnet |

## Quickstart — end-to-end cross-currency demo (4 commands)

The full demo (provision testnet + provision DB + run cross-currency payment)
fits in four commands. No manual DB editing, no Prisma Studio, no copy-paste
of secrets between scripts.

```bash
# 1. Install + build (one-time)
pnpm install && pnpm --filter @aegis/stellar build

# 2. Apply the multi-chain Prisma migration (one-time)
pnpm --filter @aegis/api db:migrate

# 3. Provision Stellar testnet accounts + DEX liquidity (~30s)
#    Writes packages/stellar/.demo-state.json with all account info
pnpm --filter @aegis/stellar setup-demo
#    → Adds STELLAR_DEMO_USDC_ISSUER + STELLAR_DEMO_EURC_ISSUER (and *_SECRET)
#      to apps/api/.env per the printed instructions.

# 4. Provision the DB (company + treasury + vendor + agent + policy + budget)
#    from the .demo-state.json — fully automated, no manual data entry.
pnpm --filter @aegis/api db:seed-stellar
#    → Prints the API key for the demo agent.

# Then start the server and submit a cross-currency spend request:
pnpm --filter @aegis/api dev

curl -X POST http://localhost:3001/spend-requests \
  -H "Authorization: Bearer <API key from step 4>" \
  -H "Content-Type: application/json" \
  -d '{
    "actionType":"purchase_api_access",
    "vendor":"OpenAI EU",
    "amount":25,
    "currency":"USDC",
    "receiveAsset":"EURC",
    "reason":"GPT-4 credits for European campaign"
  }'

# Then execute the spend request — the path payment fires:
curl -X POST http://localhost:3001/spend-requests/<id>/execute \
  -H "Authorization: Bearer <API key>"
# Response includes explorerUrl pointing to stellar.expert showing the atomic swap.
```

## Bringing your own wallet (no setup-demo)

If you have an existing Stellar account funded with USDC and want to use it
as a treasury without going through setup-demo:

```bash
# Create a treasury importing your existing keypair:
curl -X POST http://localhost:3001/companies/<companyId>/treasuries \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Stellar Treasury",
    "network": "stellar-testnet",
    "baseCurrency": "USDC",
    "importedSecret": "<S... or base64 of S...>"
  }'

# Establish a trustline to a non-XLM asset later (e.g. EURC):
curl -X POST http://localhost:3001/companies/<companyId>/treasuries/<treasuryId>/trustlines \
  -H "Content-Type: application/json" \
  -d '{ "assetCode": "EURC", "assetIssuer": "G..." }'

# Or use fund-demo for a one-shot Friendbot + trustline + USDC funding:
curl -X POST http://localhost:3001/companies/<companyId>/treasuries/<treasuryId>/fund-demo \
  -H "Content-Type: application/json" -d '{"amount":1000}'
```

## Environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `STELLAR_HORIZON_URL` | Custom Horizon endpoint (self-hosted) | Public testnet/mainnet |
| `STELLAR_SLIPPAGE_BPS` | Slippage tolerance for path quotes | 100 (= 1%) |
| `STELLAR_DEMO_USDC_ISSUER` | USDC issuer pubkey on testnet | (required for testnet USDC) |
| `STELLAR_DEMO_EURC_ISSUER` | EURC issuer pubkey on testnet | (required for testnet EURC) |

Mainnet uses Circle's official issuers (hardcoded in `assets.ts`):
- USDC: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- EURC: `GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2`

## Roadmap

- **Anchor SEP-31 integration** — let vendors receive BRL/EUR fiat in their bank account
- **Soroban policy contracts** — migrate the policy engine to on-ledger smart contracts
- **AUTH_REVOCABLE clawback** — true on-chain kill switch (requires Aegis-issued asset)
- **Multi-asset treasury** — single treasury holding USDC + EURC + XLM with auto-rebalancing

## References

- Stellar Path Payments: https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/path-payments
- Stellar Asset Model & Trustlines: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets
- Friendbot (testnet faucet): https://developers.stellar.org/docs/tools/developer-tools#friendbot
- Soroban: https://soroban.stellar.org
