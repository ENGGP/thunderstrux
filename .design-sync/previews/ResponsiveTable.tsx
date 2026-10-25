import { ResponsiveTable, StatusBadge } from 'thunderstrux';

type Order = { id: string; buyer: string; email: string; event: string; tickets: number; total: string; status: 'paid' | 'refunded' | 'pending' };

const orders: Order[] = [
  { id: 'TS-4821', buyer: 'Priya Natarajan', email: 'priya@student.unimelb.edu.au', event: 'Spring Ball 2027', tickets: 2, total: '$90.00', status: 'paid' },
  { id: 'TS-4817', buyer: 'Tom Okafor', email: 'tom.okafor@gmail.com', event: 'Spring Ball 2027', tickets: 1, total: '$45.00', status: 'refunded' },
  { id: 'TS-4809', buyer: 'Mei Chen', email: 'mei.chen@student.monash.edu', event: 'Chess Night', tickets: 4, total: '$20.00', status: 'pending' },
];

export const Orders = () => (
  <ResponsiveTable<Order>
    card={(order) => (
      <>
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold text-ink">{order.buyer}</span>
          <StatusBadge status={order.status} />
        </div>
        <span className="text-sm text-ink-soft">{order.event} · {order.tickets} tickets</span>
        <span className="text-sm font-semibold text-ink tabular-nums">{order.total}</span>
      </>
    )}
    columns={[
      { header: 'Order', cell: (order) => <span className="font-semibold text-ink">{order.id}</span>, className: 'whitespace-nowrap' },
      { header: 'Buyer', cell: (order) => <><p className="text-ink">{order.buyer}</p><p className="text-caption text-ink-soft">{order.email}</p></> },
      { header: 'Event', cell: (order) => order.event },
      { header: 'Tickets', cell: (order) => order.tickets, align: 'right' },
      { header: 'Total', cell: (order) => order.total, align: 'right' },
      { header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
    ]}
    label="Orders"
    rowKey={(order) => order.id}
    rows={orders}
  />
);
