import { StatusBadge } from 'thunderstrux';

export const OrderStatuses = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <StatusBadge status="pending" />
    <StatusBadge status="paid" />
    <StatusBadge status="failed" />
    <StatusBadge status="expired" />
  </div>
);

export const EventAndStaffStatuses = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <StatusBadge status="draft" />
    <StatusBadge status="published" />
    <StatusBadge status="active" />
    <StatusBadge status="revoked" />
    <StatusBadge status="accepted" />
    <StatusBadge status="joined" />
  </div>
);

export const TicketStatuses = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <StatusBadge status="unused" />
    <StatusBadge status="checked-in" />
    <StatusBadge status="paid" label="2 tickets paid" />
  </div>
);
