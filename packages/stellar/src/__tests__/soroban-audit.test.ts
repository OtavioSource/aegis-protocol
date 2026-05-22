import { describe, it, expect } from 'vitest';
import { buildRecordDecisionArgs } from '../soroban-audit.js';
import { xdr } from '@stellar/stellar-sdk';

describe('buildRecordDecisionArgs', () => {
  const companyId = '550e8400-e29b-41d4-a716-446655440000';
  const record = {
    spendRequestId: '550e8400-e29b-41d4-a716-446655440001',
    agentId: '550e8400-e29b-41d4-a716-446655440002',
    vendorId: '550e8400-e29b-41d4-a716-446655440003',
    amountCents: 500,
    assetCode: 'USDC',
    decision: 'Approved' as const,
    reason: 'within policy',
    timestampMs: 1_700_000_000_000,
    policyId: '550e8400-e29b-41d4-a716-446655440004',
    policyVersion: 1,
  };

  it('returns exactly 2 ScVal args', () => {
    const args = buildRecordDecisionArgs(companyId, record);
    expect(args).toHaveLength(2);
  });

  it('first arg is scvBytes with 16 bytes (UUID)', () => {
    const args = buildRecordDecisionArgs(companyId, record);
    const companyIdScVal = args[0]!;
    expect(companyIdScVal.switch().name).toBe('scvBytes');
    expect(companyIdScVal.bytes().length).toBe(16);
  });

  it('second arg is scvMap (DecisionRecord)', () => {
    const args = buildRecordDecisionArgs(companyId, record);
    const recordScVal = args[1]!;
    expect(recordScVal.switch().name).toBe('scvMap');
  });

  it('scvMap has 10 entries (all fields)', () => {
    const args = buildRecordDecisionArgs(companyId, record);
    const recordScVal = args[1]!;
    expect(recordScVal.map()!.length).toBe(10);
  });

  it('scvMap entries are sorted by key (XDR requirement)', () => {
    const args = buildRecordDecisionArgs(companyId, record);
    const recordScVal = args[1]!;
    const entries = recordScVal.map()!;
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!.key().toXDR();
      const curr = entries[i]!.key().toXDR();
      expect(prev.compare(curr)).toBeLessThanOrEqual(0);
    }
  });
});
