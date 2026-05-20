import {
  Badge,
  EmptyState,
  fmtDate,
  PageHeader,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { AuditEvent, Listed } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const audit = await api.get<Listed<AuditEvent>>('/v1/audit?limit=200');

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Trilha imutável de eventos. O recibo on-chain (Soroban) entra na iteração 12."
      />

      {audit.data.length === 0 ? (
        <EmptyState>Nenhum evento de auditoria ainda.</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Data</Th>
              <Th>Evento</Th>
              <Th>Ator</Th>
              <Th>Payload</Th>
            </Tr>
          </THead>
          <tbody>
            {audit.data.map((e) => (
              <Tr key={e.id}>
                <Td>{fmtDate(e.createdAt)}</Td>
                <Td>
                  <Badge tone="blue">{e.eventType}</Badge>
                </Td>
                <Td>
                  <code className="text-xs text-slate-400">{e.actor}</code>
                </Td>
                <Td>
                  <code className="block max-w-md truncate text-xs text-slate-500">
                    {JSON.stringify(e.payload)}
                  </code>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
