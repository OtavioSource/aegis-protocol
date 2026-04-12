import { z } from 'zod';

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
  network: z.enum(['devnet', 'mainnet-beta']).default('devnet'),
  baseCurrency: z.enum(['USDC', 'SOL']).default('USDC'),
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
  currency: z.enum(['USDC', 'SOL']).default('USDC'),
});

// ─── Spend Request ───────────────────────────────────────────────────────────

export const CreateSpendRequestSchema = z.object({
  actionType: z.string().min(1).max(100),
  vendor: z.string().min(1).max(100),
  amount: z.number().positive(),
  currency: z.enum(['USDC', 'SOL']).default('USDC'),
  reason: z.string().min(1).max(500),
  reference: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).default({}),
});

// ─── Approval ────────────────────────────────────────────────────────────────

export const ApprovalDecisionSchema = z.object({
  decisionReason: z.string().min(1).max(500).optional(),
});

// ─── Vendor ──────────────────────────────────────────────────────────────────

export const CreateVendorSchema = z.object({
  name: z.string().min(1).max(100),
  walletAddress: z.string().min(32).max(44), // Solana base58 pubkey length
  description: z.string().max(300).optional(),
});

export const UpdateVendorSchema = z.object({
  walletAddress: z.string().min(32).max(44).optional(),
  description: z.string().max(300).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
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
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
