import { ActionForm } from '@/components/action-form';
import {
  EmptyState,
  Field,
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
import { createAgent } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Agent, Listed, Policy } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const [agents, policies] = await Promise.all([
    api.get<Listed<Agent>>('/v1/agents'),
    api.get<Listed<Policy>>('/v1/policies'),
  ]);
  const policyName = new Map(policies.data.map((p) => [p.id, `${p.name} v${p.version}`]));

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Identidades de IA que enviam spend requests. Cada agente tem uma API key cr_."
      />

      <div className="mb-6">
        <SectionCard title="Novo agente">
          <ActionForm action={createAgent} submitLabel="Criar agente">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome">
                <Input name="name" required placeholder="Customer Success Bot" />
              </Field>
              <Field label="Política ativa">
                <Select name="activePolicyId" required>
                  <option value="">Selecione…</option>
                  {policies.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} v{p.version}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Descrição (opcional)">
              <Input name="description" placeholder="Agente para automação tier-1" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {agents.data.length === 0 ? (
        <EmptyState>Nenhum agente cadastrado.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th>API key</Th>
              <Th>Política</Th>
              <Th>Status</Th>
              <Th>Criado</Th>
            </Tr>
          </THead>
          <tbody>
            {agents.data.map((a) => (
              <Tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>
                  <code className="text-xs text-slate-400">{a.apiKeyPrefix}…</code>
                </Td>
                <Td>{policyName.get(a.activePolicyId) ?? a.activePolicyId}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>{fmtDate(a.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
