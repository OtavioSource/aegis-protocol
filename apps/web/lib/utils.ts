import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, currency = 'USDC') {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStatusColor(status: string) {
  const map: Record<string, string> = {
    APPROVED: 'bg-green-100 text-green-800',
    EXECUTED: 'bg-blue-100 text-blue-800',
    REQUIRES_APPROVAL: 'bg-yellow-100 text-yellow-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    REJECTED: 'bg-red-100 text-red-800',
    FAILED: 'bg-red-100 text-red-800',
    ACTIVE: 'bg-green-100 text-green-800',
    DISABLED: 'bg-gray-100 text-gray-600',
    FROZEN: 'bg-red-100 text-red-800',
  };
  return map[status] ?? 'bg-gray-100 text-gray-600';
}
