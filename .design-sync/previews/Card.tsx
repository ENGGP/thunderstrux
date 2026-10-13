import { Button, Card, StatusBadge } from 'thunderstrux';

export const EventSummary = () => (
  <Card className="max-w-md">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
      <h3 className="font-display text-xl font-semibold text-ink">Spring Ball 2027</h3>
      <StatusBadge status="published" />
    </div>
    <p className="mt-2 text-sm text-ink-soft">Sat 20 March, 7:00 pm · Union Ballroom</p>
    <p className="mt-4 text-sm text-ink-muted">128 of 300 tickets sold</p>
    <div className="mt-5">
      <Button size="sm">Manage event</Button>
    </div>
  </Card>
);

export const Plain = () => (
  <Card className="max-w-md">
    <p className="text-sm text-ink-soft">
      Cards are a white surface with a hairline border and rounded corners. Put any content inside.
    </p>
  </Card>
);
