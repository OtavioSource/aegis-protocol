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

## Quickstart (cross-currency demo)

```bash
# 1. Install + build the workspace
pnpm install
pnpm --filter @aegis/stellar build

# 2. Provision testnet accounts + DEX liquidity (~30 seconds)
pnpm --filter @aegis/stellar setup-demo

# 3. Copy the printed STELLAR_DEMO_*_ISSUER lines into apps/api/.env

# 4. Start the API
pnpm --filter @aegis/api dev

# 5. Quote a path payment
curl 'http://localhost:3001/stellar/path-quote?sourceAsset=USDC&receiveAsset=EURC&amount=25&network=stellar-testnet&fromAccount=G...'
# → { sourceMax: 27.50, effectiveRate: 1.10, path: ['XLM'], validUntil: ... }

# 6. Submit a SpendRequest with cross-currency intent
curl -X POST http://localhost:3001/spend-requests \
  -H "Authorization: Bearer cr_..." \
  -H "Content-Type: application/json" \
  -d '{
    "actionType": "purchase_api_access",
    "vendor": "OpenAI EU",
    "amount": 25,
    "currency": "USDC",
    "receiveAsset": "EURC",
    "reason": "GPT-4 credits for European campaign"
  }'

# 7. Execute (path payment fires)
curl -X POST http://localhost:3001/spend-requests/<id>/execute \
  -H "Authorization: Bearer cr_..."
# Response includes explorerUrl pointing to stellar.expert showing the atomic swap
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
