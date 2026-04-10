import { cn, getStatusColor } from '@/lib/utils';

type BadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

export function Badge({ status, label, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        getStatusColor(status),
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
