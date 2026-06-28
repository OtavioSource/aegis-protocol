import { ActionForm } from '@/components/action-form';
import { CopyButton } from '@/components/copy-button';
import { InfoTooltip } from '@/components/info-tooltip';
import {
  Badge,
  EmptyState,
  Field,
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
import { createVendor, sponsorWallet } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  const vendors = await api.get<Listed<Vendor>>('/v1/vendors');

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Payment beneficiaries. Wallets are sponsored (CAP-33): vendors never touch XLM."
      />

      <div className="mb-6">
        <SectionCard title="New vendor">
          <ActionForm action={createVendor} submitLabel="Create vendor">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input name="name" required placeholder="Anthropic" />
              </Field>
              <Field label="Preferred asset">
                <Select name="preferredAsset" defaultValue="USDC">
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                  <option value="XLM">XLM</option>
                </Select>
              </Field>
            </div>
            <Field label="Description (optional)">
              <Input name="description" placeholder="LLM API provider" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="sponsorWallet" className="accent-accent" />
              Sponsor wallet on-chain now
              <InfoTooltip text="Aegis creates the vendor's Stellar account and opens the USDC trustline on-chain, paying the base reserves for them. The vendor never needs to hold XLM or interact with the blockchain. (Stellar CAP-33.)" />
            </label>
          </ActionForm>
        </SectionCard>
      </div>

      {vendors.data.length === 0 ? (
        <EmptyState>No vendors registered.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Vendor ID</Th>
              <Th>Asset</Th>
              <Th>Status</Th>
              <Th>Wallet (payTo)</Th>
              <Th>Action</Th>
            </Tr>
          </THead>
          <tbody>
            {vendors.data.map((v) => {
              const wallet = v.wallets?.[0];
              return (
                <Tr key={v.id}>
                  <Td>{v.name}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <code className="text-xs text-slate-400">{v.id.slice(0, 8)}…</code>
                      <CopyButton value={v.id} title="Copiar AEGIS_VENDOR_ID" />
                    </span>
                  </Td>
                  <Td>{v.preferredAsset}</Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td>
                    {wallet ? (
                      <span className="flex items-center gap-1.5">
                        <code className="text-xs text-slate-400">
                          {wallet.publicKey.slice(0, 6)}…{wallet.publicKey.slice(-4)}
                        </code>
                        <CopyButton value={wallet.publicKey} title="Copiar VENDOR_WALLET_PUBLIC_KEY" />
                        <Badge tone="green">{wallet.status}</Badge>
                      </span>
                    ) : (
                      <Badge tone="gray">no wallet</Badge>
                    )}
                  </Td>
                  <Td>
                    {wallet ? (
                      '—'
                    ) : (
                      <ActionForm action={sponsorWallet} submitLabel="Sponsor" submitVariant="subtle">
                        <input type="hidden" name="vendorId" value={v.id} />
                      </ActionForm>
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
