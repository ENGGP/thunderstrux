import { ListSkeleton } from 'thunderstrux';

export const EventsLoading = () => (
  <div style={{ maxWidth: 560 }}>
    <ListSkeleton label="Loading events" rows={3} />
  </div>
);
