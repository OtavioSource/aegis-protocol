import { z } from 'zod';

// ─── Settlement Network ───────────────────────────────────────────────────────
//
// Shared enum-like schema for chain identifiers. Used by Treasury and
// VendorWallet schemas. Add new chains here as adapters are implemented.

export const SettlementNetworkSchema = z.enum([
  'devnet',           // Solana devnet
  'mainnet-beta',     // Solana mainnet
  'stellar-testnet',  // Stellar testnet (Friendbot funding)
  'stellar-mainnet',  // Stellar mainnet
]);

export type SettlementNetworkInput = z.infer<typeof SettlementNetworkSchema>;

// Currency codes supported across chains.
// USDC: Circle USD stablecoin (Solana SPL + Stellar asset).
// SOL:  native Solana token (gas).
// XLM:  native Stellar token (gas + base liquidity asset on DEX paths).
// EURC: Circle Euro stablecoin (Stellar — used as receiveAsset for European vendors).
export const CurrencySchema = z.enum(['USDC', 'SOL', 'XLM', 'EURC']);

// ─── Company ─────────────────────────────────────────────────────────────────

export const CreateCompanySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
});

export const CreateTreasurySchema = z.object({
  name: z.string().min(1).max(100),
  network: SettlementNetworkSchema.default('devnet'),
  baseCurrency: CurrencySchema.default('USDC'),
  // Optional: import an existing wallet instead of generating a fresh one.
  // Useful when bringing in a pre-funded account (e.g. setup-demo treasury,
  // or a real customer wallet). The format is chain-specific:
  //   - Solana:  base64-encoded 64-byte secret key
  //   - Stellar: the S... secret string OR base64 of it
  // The chain adapter normalizes whichever encoding is provided.
  importedSecret: z.string().min(50).max(200).optional(),
});

// ─── Agent ───────────────────────────────────────────────────────────────────

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  externalAgentId: z.string().optional(),
  ownerName: z.string().optional(),
  ownerEmail: z.string().email().optional(),
  treasuryId: z.string().min(1).optional(),
});

export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ownerName: z.string().optional(),
  ownerEmail: z.string().email().optional(),
});

// ─── Policy ──────────────────────────────────────────────────────────────────

export const PolicyRulesSchema = z.object({
  maxTransactionAmount: z.number().positive().optional(),
  dailyBudget: z.number().positive().optional(),
  monthlyBudget: z.number().positive().optional(),
  vendorAllowList: z.array(z.string()).optional(),
  vendorDenyList: z.array(z.string()).optional(),
  requireApprovalAbove: z.number().positive().optional(),
  allowedActionTypes: z.array(z.string()).optional(),
});

export const AssignPolicySchema = z.object({
  name: z.string().min(1).max(100),
  rules: PolicyRulesSchema,
});

// ─── Budget ──────────────────────────────────────────────────────────────────

export const CreateBudgetSchema = z.object({
  agentId: z.string().min(1),
  dailyLimit: z.number().positive(),
  monthlyLimit: z.number().positive(),
  perTransactionLimit: z.number().positive(),
  currency: CurrencySchema.default('USDC'),
});

// ─── Spend Request ───────────────────────────────────────────────────────────

export const CreateSpendRequestSchema = z.object({
  actionType: z.string().min(1).max(100),
  vendor: z.string().min(1).max(100),
  amount: z.number().positive(),
  currency: CurrencySchema.default('USDC'),
  // receiveAsset (Stellar path payment): asset the vendor receives.
  // If omitted or equal to currency → same-asset transfer (no path payment).
  // If different → triggers Stellar pathPaymentStrictReceive at execute time.
  receiveAsset: CurrencySchema.optional(),
  reason: z.string().min(1).max(500),
  reference: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).default({}),
});

// ─── Approval ────────────────────────────────────────────────────────────────

export const ApprovalDecisionSchema = z.object({
  decisionReason: z.string().min(1).max(500).optional(),
});

// ─── Vendor ──────────────────────────────────────────────────────────────────
//
// Wallet address validation accepts both Solana (32-44 base58) and Stellar
// (56 chars starting with G). Stricter per-network validation is enforced
// at the chain adapter layer (Keypair construction will throw on invalid input).

const WalletAddressSchema = z.string().min(32).max(56);

export const CreateVendorSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  // Required initial wallet — every vendor must have at least one wallet
  // on at least one chain to receive payments.
  initialWallet: z
    .object({
      network: SettlementNetworkSchema,
      walletAddress: WalletAddressSchema,
      trustedAssets: z.array(z.string()).optional(),
    })
    .optional(),
  // DEPRECATED: top-level walletAddress kept for back-compat with existing
  // Solana-only callers. If both provided, initialWallet wins.
  walletAddress: WalletAddressSchema.optional(),
});

export const UpdateVendorSchema = z.object({
  walletAddress: WalletAddressSchema.optional(),
  description: z.string().max(300).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
});

// Add a new wallet to an existing vendor (e.g. after registering on Stellar).
export const AddVendorWalletSchema = z.object({
  network: SettlementNetworkSchema,
  walletAddress: WalletAddressSchema,
  trustedAssets: z.array(z.string()).optional(),
});

// ─── User ─────────────────────────────────────────────────────────────────────

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(100),
  role: z.enum(['OWNER', 'ADMIN', 'VIEWER']).default('ADMIN'),
  phone: z.string().optional(),
  notifyEmail: z.boolean().default(true),
  notifySms: z.boolean().default(false),
});

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;
export type CreateTreasuryInput = z.infer<typeof CreateTreasurySchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type AssignPolicyInput = z.infer<typeof AssignPolicySchema>;
export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>;
export type CreateSpendRequestInput = z.infer<typeof CreateSpendRequestSchema>;
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionSchema>;
export type CreateVendorInput = z.infer<typeof CreateVendorSchema>;
export type UpdateVendorInput = z.infer<typeof UpdateVendorSchema>;
export type AddVendorWalletInput = z.infer<typeof AddVendorWalletSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
