import { api, COMPANY_ID } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { Store } from 'lucide-react';
import { RegisterVendorButton } from './register-vendor-form';

type Vendor = {
  id: string;
  name: string;
  walletAddress: string;
  description: string | null;
  status: string;
  createdAt: string;
};

export default async function VendorsPage() {
  const vendors = await api
    .get<Vendor[]>(`/companies/${COMPANY_ID}/vendors`)
    .catch(() => [] as Vendor[]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <p className="text-gray-500 mt-1">
            Registered payment recipients — each vendor has a real Solana wallet address
          </p>
        </div>
        <RegisterVendorButton companyId={COMPANY_ID} />
      </div>

      {vendors.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Store className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No vendors registered</p>
          <p className="text-sm mt-1">
            Register vendors to enable real multi-wallet Solana transfers
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="p-2 rounded-lg bg-violet-50 shrink-0">
                  <Store className="h-4 w-4 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{vendor.name}</p>
                    <Badge status={vendor.status} />
                  </div>
                  {vendor.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{vendor.description}</p>
                  )}
                  <p className="text-xs font-mono text-gray-400 mt-1 truncate">
                    {vendor.walletAddress}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400 shrink-0 ml-4">{formatDate(vendor.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
