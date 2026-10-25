import { AuditTimeline } from 'thunderstrux';

export const OrderHistory = () => (
  <div style={{ maxWidth: 560 }}>
    <AuditTimeline
      empty="Nothing has happened to this order yet."
      entries={[
        { id: '3', title: 'Refund issued', time: new Date('2027-03-14T09:42:00Z'), meta: 'By Alex Morgan (Owner)', details: ['$45.00 back to the card ending 4242', 'Reason: event clash'] },
        { id: '2', title: 'Tickets emailed', time: new Date('2027-03-02T03:15:00Z'), meta: 'Automatic' },
        { id: '1', title: 'Order paid', time: new Date('2027-03-02T03:14:00Z'), meta: 'Card payment via Stripe' },
      ]}
      heading="Order history"
      note="Times are in the society's time zone."
      timeZone="Australia/Melbourne"
    />
  </div>
);

export const Empty = () => (
  <div style={{ maxWidth: 560 }}>
    <AuditTimeline empty="Nothing has happened to this order yet." entries={[]} heading="Order history" />
  </div>
);
