import { ActionForm } from '@/components/action-form';
import {
  EmptyState,
  Field,
  fmtCents,
  fmtDate,
  Input,
  PageHeader,
  SectionCard,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import {
  initiateDeposit,
  initiateWithdrawal,
  refreshDeposit,
  refreshWithdrawal,
  simulateDeposit,
} from '@/lib/actions';
import { api } from '@/lib/api';
import type { FiatDeposit, FiatWithdrawal, Listed } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Identifier USDC do anchor (testnet) — usado como default nas quotes. */
const USDC_IDENTIFIER = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const TERMINAL = ['COMPLETED', 'FAILED', 'REFUNDED'];

export default async function FiatPage() {
  const [deposits, withdrawals] = await Promise.all([
    api.get<Listed<FiatDeposit>>('/v1/fiat/deposits?limit=100'),
    api.get<Listed<FiatWithdrawal>>('/v1/fiat/withdrawals?limit=100'),
  ]);

  return (
    <>
      <PageHeader
        title="Fiat ramp"
        description="Move money between fiat currencies (BRL, MXN) and the USDC treasury via the Etherfuse anchor. Deposit fiat to fund the treasury; withdraw USDC to send fiat back to a bank account."
      />

      {/* ----- On-ramp ----- */}
      <div className="mb-4">
        <SectionCard title="New deposit (on-ramp Etherfuse)">
          <ActionForm action={initiateDeposit} submitLabel="Start deposit">
            <input type="hidden" name="provider" value="etherfuse" />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fiat currency">
                <Select name="sourceAsset" defaultValue="BRL">
                  <option value="BRL">BRL (Pix)</option>
                  <option value="MXN">MXN (SPEI)</option>
                </Select>
              </Field>
              <Field label="Fiat amount (cents)" hint="2500 = R$ 25.00">
                <Input name="sourceAmountCents" type="number" min="1" required placeholder="2500" />
              </Field>
              <Field label="Target asset">
                <Input name="asset" defaultValue="USDC" />
              </Field>
            </div>
            <Field label="Target asset identifier">
              <Input name="targetAssetIdentifier" defaultValue={USDC_IDENTIFIER} />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {deposits.data.length === 0 ? (
        <EmptyState>No deposits yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Anchor</Th>
              <Th>Asset</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <tbody>
            {deposits.data.map((d) => {
              const etherfuse = d.anchorId.startsWith('etherfuse');
              const terminal = TERMINAL.includes(d.status);
              return (
                <Tr key={d.id}>
                  <Td>{fmtDate(d.createdAt)}</Td>
                  <Td>{d.anchorId}</Td>
                  <Td>{d.asset}</Td>
                  <Td>{fmtCents(d.actualAmountCents ?? d.amountCents)}</Td>
                  <Td>
                    <StatusBadge status={d.status} />
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {etherfuse && !terminal ? (
                        <ActionForm action={simulateDeposit} submitLabel="Simulate Pix" submitVariant="subtle">
                          <input type="hidden" name="depositId" value={d.id} />
                        </ActionForm>
                      ) : null}
                      {!terminal ? (
                        <ActionForm action={refreshDeposit} submitLabel="Refresh" submitVariant="ghost">
                          <input type="hidden" name="depositId" value={d.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* ----- Off-ramp ----- */}
      <div className="mb-4 mt-8">
        <SectionCard title="New withdrawal (off-ramp Etherfuse)">
          <ActionForm action={initiateWithdrawal} submitLabel="Start withdrawal">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Asset (outflow)">
                <Input name="asset" defaultValue="USDC" />
              </Field>
              <Field label="Amount (cents)" hint="175 = 1.75 USDC">
                <Input name="amountCents" type="number" min="1" required placeholder="175" />
              </Field>
              <Field label="Target fiat currency">
                <Select name="targetFiat" defaultValue="BRL">
                  <option value="BRL">BRL (Pix)</option>
                  <option value="MXN">MXN (SPEI)</option>
                </Select>
              </Field>
            </div>
            <Field label="Asset identifier">
              <Input name="assetIdentifier" defaultValue={USDC_IDENTIFIER} />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {withdrawals.data.length === 0 ? (
        <EmptyState>No withdrawals yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Asset</Th>
              <Th>Amount</Th>
              <Th>Fiat</Th>
              <Th>Status</Th>
              <Th>Tx</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <tbody>
            {withdrawals.data.map((w) => {
              const terminal = TERMINAL.includes(w.status);
              return (
                <Tr key={w.id}>
                  <Td>{fmtDate(w.createdAt)}</Td>
                  <Td>{w.asset}</Td>
                  <Td>{fmtCents(w.actualAmountCents ?? w.amountCents)}</Td>
                  <Td>{w.targetFiat ?? '—'}</Td>
                  <Td>
                    <StatusBadge status={w.status} />
                  </Td>
                  <Td>
                    {w.stellarExpertUrl ? (
                      <a
                        href={w.stellarExpertUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        burn
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {!terminal ? (
                      <ActionForm action={refreshWithdrawal} submitLabel="Refresh" submitVariant="ghost">
                        <input type="hidden" name="withdrawalId" value={w.id} />
                      </ActionForm>
                    ) : (
                      '—'
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
