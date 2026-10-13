import { Button } from 'thunderstrux';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button variant="primary">Buy tickets</Button>
    <Button variant="secondary">Save draft</Button>
    <Button variant="tertiary">View details</Button>
    <Button variant="danger">Cancel event</Button>
    <Button variant="dangerSolid">Delete account</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <Button disabled>Processing…</Button>
    <Button disabled variant="secondary">Unavailable</Button>
  </div>
);
