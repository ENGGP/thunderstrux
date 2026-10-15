import { ListSkeleton, Skeleton } from 'thunderstrux';

export const Blocks = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
    <Skeleton className="h-6 w-48" />
    <Skeleton className="h-20" />
  </div>
);

export const List = () => (
  <div style={{ maxWidth: 560 }}>
    <ListSkeleton label="Loading events" rows={3} />
  </div>
);
