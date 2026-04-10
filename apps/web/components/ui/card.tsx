import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-6 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-gray-500 mb-1">{children}</h3>;
}

export function CardValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-2xl font-bold text-gray-900', className)}>{children}</p>;
}
