import { Skeleton } from 'thunderstrux';

export const Blocks = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
    <Skeleton className="h-6 w-48" />
    <Skeleton className="h-4 w-80" />
    <Skeleton className="h-28 rounded-card" />
  </div>
);
