'use server';

/**
 * Server actions do dashboard — todas falam com a Aegis API via `lib/api`.
 * Cada action devolve ActionState (consumido pelo <ActionForm> client) e
 * revalida a rota afetada.
 */

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/components/action-form';
import { api, ApiError } from '@/lib/api';

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Converte valor em dólares (string como "50" ou "12.34") para centavos arredondados. */
function dollarsToCents(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function fail(message: string): ActionState {
  return { ok: false, message };
}

async function run(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return fail(err.message);
    return fail((err as Error).message || 'Unexpected error');
  }
}

// ----------------------------------------------------------- approvals ----

export async function approveSpend(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, 'spendRequestId');
    const action = str(fd, 'action'); // APPROVED | REJECTED
    if (!id || !action) return fail('spendRequestId and action required');
    await api.post(`/v1/approvals/${id}`, {
      action,
      reason: str(fd, 'reason') || undefined,
    });
    revalidatePath('/approvals');
    revalidatePath('/spend-requests');
    revalidatePath('/');
    return { ok: true, message: action === 'APPROVED' ? 'Approved and executed.' : 'Rejected.' };
  });
}

// ------------------------------------------------------- spend requests ----

export async function createSpendRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const amountCents = dollarsToCents(fd, 'amount');
    if (!amountCents || amountCents <= 0) return fail('Amount must be positive');
    await api.post(
      '/v1/spend-requests',
      {
        vendorId: str(fd, 'vendorId'),
        amountCents,
        asset: str(fd, 'asset') || 'USDC',
        actionType: str(fd, 'actionType'),
        reason: str(fd, 'reason') || undefined,
      },
      { 'Idempotency-Key': randomUUID() },
    );
    revalidatePath('/spend-requests');
    revalidatePath('/');
    return { ok: true, message: 'Spend request created.' };
  });
}

// ------------------------------------------------------------ policies ----

export async function createPolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const name = str(fd, 'name');
    if (!name) return fail('Name required');
    const actionTypes = str(fd, 'actionTypes')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await api.post('/v1/policies', {
      name,
      rules: {
        maxPerTransactionCents: dollarsToCents(fd, 'maxPerTransaction'),
        monthlyBudgetCents: dollarsToCents(fd, 'monthlyBudget'),
        humanApprovalThresholdCents: dollarsToCents(fd, 'humanApprovalThreshold'),
        vendorAllowList: [],
        vendorDenyList: [],
        actionTypes,
      },
    });
    revalidatePath('/policies');
    return { ok: true, message: 'Policy created.' };
  });
}

// -------------------------------------------------------------- agents ----

export async function createAgent(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const name = str(fd, 'name');
    const activePolicyId = str(fd, 'activePolicyId');
    if (!name || !activePolicyId) return fail('Name and policy required');
    const created = await api.post<{ apiKey: string }>('/v1/agents', {
      name,
      description: str(fd, 'description') || undefined,
      activePolicyId,
    });
    revalidatePath('/agents');
    return { ok: true, message: 'Agent created.', secret: created.apiKey };
  });
}

// ------------------------------------------------------------- vendors ----

export async function createVendor(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const name = str(fd, 'name');
    if (!name) return fail('Name required');
    await api.post('/v1/vendors', {
      name,
      description: str(fd, 'description') || undefined,
      preferredAsset: str(fd, 'preferredAsset') || 'USDC',
      sponsorWallet: str(fd, 'sponsorWallet') === 'on',
    });
    revalidatePath('/vendors');
    return { ok: true, message: 'Vendor created.' };
  });
}

export async function sponsorWallet(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, 'vendorId');
    if (!id) return fail('vendorId required');
    const res = await api.post<{ wallet: { publicKey: string } }>(
      `/v1/vendors/${id}/wallets/sponsor`,
    );
    revalidatePath('/vendors');
    return { ok: true, message: `Wallet sponsored: ${res.wallet.publicKey}` };
  });
}

// ---------------------------------------------------------------- fiat ----

export async function initiateDeposit(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const provider = str(fd, 'provider') || 'etherfuse';
    if (provider === 'etherfuse') {
      const sourceAmountCents = intOrNull(fd, 'sourceAmountCents');
      if (!sourceAmountCents || sourceAmountCents <= 0) {
        return fail('sourceAmountCents must be positive');
      }
      await api.post('/v1/fiat/deposits', {
        provider: 'etherfuse',
        sourceAsset: str(fd, 'sourceAsset') || 'BRL',
        sourceAmountCents,
        asset: str(fd, 'asset') || 'USDC',
        targetAssetIdentifier: str(fd, 'targetAssetIdentifier'),
      });
    } else {
      const amountCents = intOrNull(fd, 'amountCents');
      if (!amountCents || amountCents <= 0) return fail('amountCents must be positive');
      await api.post('/v1/fiat/deposits', {
        provider: 'sep24',
        amountCents,
        asset: str(fd, 'asset') || 'USDC',
      });
    }
    revalidatePath('/fiat');
    return { ok: true, message: 'Deposit initiated.' };
  });
}

export async function simulateDeposit(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, 'depositId');
    if (!id) return fail('depositId required');
    await api.post(`/v1/fiat/deposits/${id}/simulate`);
    revalidatePath('/fiat');
    return { ok: true, message: 'Pix/SPEI simulated.' };
  });
}

export async function refreshDeposit(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, 'depositId');
    if (!id) return fail('depositId required');
    await api.post(`/v1/fiat/deposits/${id}/refresh`);
    revalidatePath('/fiat');
    return { ok: true, message: 'Status refreshed.' };
  });
}

export async function initiateWithdrawal(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const amountCents = intOrNull(fd, 'amountCents');
    if (!amountCents || amountCents <= 0) return fail('amountCents must be positive');
    await api.post('/v1/fiat/withdrawals', {
      asset: str(fd, 'asset') || 'USDC',
      assetIdentifier: str(fd, 'assetIdentifier'),
      amountCents,
      targetFiat: str(fd, 'targetFiat') || 'BRL',
    });
    revalidatePath('/fiat');
    return { ok: true, message: 'Withdrawal initiated (burn submitted).' };
  });
}

export async function refreshWithdrawal(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, 'withdrawalId');
    if (!id) return fail('withdrawalId required');
    await api.post(`/v1/fiat/withdrawals/${id}/refresh`);
    revalidatePath('/fiat');
    return { ok: true, message: 'Status refreshed.' };
  });
}
