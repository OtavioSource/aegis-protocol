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
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { createPolicy } from '@/lib/actions';
import { api } from '@/lib/api';
import type { Listed, Policy } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const policies = await api.get<Listed<Policy>>('/v1/policies?all=true');

  return (
    <>
      <PageHeader
        title="Políticas"
        description="Regras determinísticas avaliadas pela engine. Limites null = sem limite."
      />

      <div className="mb-6">
        <SectionCard title="Nova política">
          <ActionForm action={createPolicy} submitLabel="Criar política">
            <Field label="Nome">
              <Input name="name" required placeholder="Conservative Policy" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Máx por transação (¢)" hint="vazio = sem limite">
                <Input name="maxPerTransactionCents" type="number" min="0" placeholder="50000" />
              </Field>
              <Field label="Orçamento mensal (¢)" hint="vazio = sem limite">
                <Input name="monthlyBudgetCents" type="number" min="0" placeholder="5000000" />
              </Field>
              <Field label="Limite p/ aprovação (¢)" hint="acima → humano">
                <Input
                  name="humanApprovalThresholdCents"
                  type="number"
                  min="0"
                  placeholder="10000"
                />
              </Field>
            </div>
            <Field label="Action types permitidos" hint="separados por vírgula; vazio = todos">
              <Input name="actionTypes" placeholder="api-call, compute, scraping" />
            </Field>
          </ActionForm>
        </SectionCard>
      </div>

      {policies.data.length === 0 ? (
        <EmptyState>Nenhuma política cadastrada.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th>Versão</Th>
              <Th>Máx/tx</Th>
              <Th>Orçamento mês</Th>
              <Th>Aprovação ≥</Th>
              <Th>Action types</Th>
              <Th>Estado</Th>
              <Th>Criada</Th>
            </Tr>
          </THead>
          <tbody>
            {policies.data.map((p) => (
              <Tr key={p.id}>
                <Td>{p.name}</Td>
                <Td>v{p.version}</Td>
                <Td>{fmtCents(p.rules.maxPerTransactionCents)}</Td>
                <Td>{fmtCents(p.rules.monthlyBudgetCents)}</Td>
                <Td>{fmtCents(p.rules.humanApprovalThresholdCents)}</Td>
                <Td>{p.rules.actionTypes.length > 0 ? p.rules.actionTypes.join(', ') : 'todos'}</Td>
                <Td>
                  {p.isActive ? <Badge tone="green">ativa</Badge> : <Badge tone="gray">inativa</Badge>}
                </Td>
                <Td>{fmtDate(p.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
