import { api, COMPANY_ID } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Wallet } from 'lucide-react';

type Treasury = {
  id: string;
  name: string;
  network: string;
  baseCurrency: string;
  walletAddress: string;
  status: string;
  createdAt: string;
};

function explorerUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export default async function TreasuryPage() {
  const treasuries = await api
    .get<Treasury[]>(`/companies/${COMPANY_ID}/treasuries`)
    .catch(() => [] as Treasury[]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Treasury</h1>
        <p className="text-gray-500 mt-1">Solana wallets used for agent spend execution</p>
      </div>

      {treasuries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No treasury configured yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {treasuries.map((t) => (
            <div
              key={t.id}
              className={`bg-white rounded-lg border p-6 shadow-sm ${t.status === 'FROZEN' ? 'border-red-300' : 'border-gray-200'}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet className="h-5 w-5 text-violet-500" />
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    <Badge status={t.status} />
                  </div>
                  <p className="text-sm text-gray-500">
                    {t.network} · {t.baseCurrency}
                  </p>
                </div>
              </div>

              <div className="mt-4 bg-gray-50 rounded-md p-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Wallet Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-gray-800 break-all">{t.walletAddress}</code>
                  <a
                    href={explorerUrl(t.walletAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-violet-600 hover:text-violet-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {t.status === 'FROZEN' && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  ⚠️ Treasury is frozen. No transfers can be executed until unfrozen.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-800">
        <p className="font-medium mb-1">Solana Devnet</p>
        <p>All treasury operations run on Solana devnet using USDC test tokens. Transaction signatures are verifiable on Solana Explorer.</p>
      </div>
    </div>
  );
}
