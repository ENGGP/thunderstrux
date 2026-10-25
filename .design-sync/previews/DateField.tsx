import { DateField } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 320 } as const;

export const Default = () => (
  <div style={col}>
    <DateField defaultValue="2027-03-20" hint="Type a date or pick one." label="Event date" />
  </div>
);

export const Empty = () => (
  <div style={col}>
    <DateField label="From" />
  </div>
);

export const WithError = () => (
  <div style={col}>
    <DateField defaultValue="2026-03-01" error="Sales must end after they start." label="Sales end" />
  </div>
);
