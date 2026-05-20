import { ActionForm } from '@/components/action-form';
import {
  Badge,
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
import { createSpendRequest } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, SpendRequest, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SpendRequestsPage() {
  const [spend, vendors] = await Promise.all([
    api.get<Listed<SpendRequest>>('/v1/spend-requests?limit=200'),
    api.get<Listed<Vendor>>('/v1/vendors'),
  ]);
  const vendorName = new Map(vendors.data.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader
        title="Spend Requests"
        description="Pedidos de gasto avaliados pela engine de políticas."
      />

      <div className="mb-6">
        <SectionCard title="Nova spend request">
          <ActionForm action={createSpendRequest} submitLabel="Criar">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor">
                <Select name="vendorId" required>
                  <option value="">Selecione…</option>
                  {vendors.data.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Action type" hint="ex: api-call, compute">
                <Input name="actionType" required placeholder="api-call" />
              </Field>
              <Field label="Valor (centavos)" hint="100 = $1.00">
                <Input name="amountCents" type="number" min="1" required placeholder="100" />
              </Field>
              <Field label="Asset">
                <Input name="asset" defaultValue="USDC" />
              </Field>
            </div>
            <Field label="Motivo (opcional)">
              <Input name="reason" placeholder="Descrição do gasto" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {spend.data.length === 0 ? (
        <EmptyState>Nenhuma spend request ainda.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Data</Th>
              <Th>Ação</Th>
              <Th>Vendor</Th>
              <Th>Valor</Th>
              <Th>Decisão</Th>
              <Th>Status</Th>
              <Th>Tx</Th>
            </Tr>
          </THead>
          <tbody>
            {spend.data.map((sr) => (
              <Tr key={sr.id}>
                <Td>{fmtDate(sr.createdAt)}</Td>
                <Td>{sr.actionType}</Td>
                <Td>{sr.vendorId ? (vendorName.get(sr.vendorId) ?? '—') : '—'}</Td>
                <Td>
                  {fmtCents(sr.amountCents)} {sr.asset}
                </Td>
                <Td>{sr.decision ? <Badge tone="gray">{sr.decision}</Badge> : '—'}</Td>
                <Td>
                  <StatusBadge status={sr.status} />
                </Td>
                <Td>
                  {sr.stellarExpertUrl ? (
                    <a
                      href={sr.stellarExpertUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      ver
                    </a>
                  ) : (
                    '—'
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
