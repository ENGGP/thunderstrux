import { DateTimeField } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 440 } as const;
const noop = () => {};

export const Default = () => (
  <div style={col}>
    <DateTimeField label="Starts" onChange={noop} value="2027-03-20T19:00" />
  </div>
);

export const WithError = () => (
  <div style={col}>
    <DateTimeField error="The event must end after it starts." label="Ends" onChange={noop} value="2027-03-20T18:00" />
  </div>
);
