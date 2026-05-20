import { ActionForm } from '@/components/action-form';
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
        description="Beneficiários dos pagamentos. A wallet é sponsoreada (CAP-33): o vendor nunca toca em XLM."
      />

      <div className="mb-6">
        <SectionCard title="Novo vendor">
          <ActionForm action={createVendor} submitLabel="Criar vendor">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome">
                <Input name="name" required placeholder="Anthropic" />
              </Field>
              <Field label="Asset preferido">
                <Select name="preferredAsset" defaultValue="USDC">
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                  <option value="XLM">XLM</option>
                </Select>
              </Field>
            </div>
            <Field label="Descrição (opcional)">
              <Input name="description" placeholder="LLM API provider" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="sponsorWallet" className="accent-accent" />
              Sponsorear a wallet on-chain agora (CAP-33)
            </label>
          </ActionForm>
        </SectionCard>
      </div>

      {vendors.data.length === 0 ? (
        <EmptyState>Nenhum vendor cadastrado.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th>Asset</Th>
              <Th>Status</Th>
              <Th>Wallet</Th>
              <Th>Ação</Th>
            </Tr>
          </THead>
          <tbody>
            {vendors.data.map((v) => {
              const wallet = v.wallets?.[0];
              return (
                <Tr key={v.id}>
                  <Td>{v.name}</Td>
                  <Td>{v.preferredAsset}</Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td>
                    {wallet ? (
                      <span className="flex items-center gap-2">
                        <code className="text-xs text-slate-400">
                          {wallet.publicKey.slice(0, 10)}…
                        </code>
                        <Badge tone="green">{wallet.status}</Badge>
                      </span>
                    ) : (
                      <Badge tone="gray">sem wallet</Badge>
                    )}
                  </Td>
                  <Td>
                    {wallet ? (
                      '—'
                    ) : (
                      <ActionForm action={sponsorWallet} submitLabel="Sponsorear" submitVariant="subtle">
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
