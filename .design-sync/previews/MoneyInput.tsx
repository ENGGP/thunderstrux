import { MoneyInput } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 280 } as const;
const noop = () => {};

export const Default = () => (
  <div style={col}>
    <MoneyInput hint="Before the Thunderstrux fee." onChange={noop} value="45.00" />
  </div>
);

export const WithError = () => (
  <div style={col}>
    <MoneyInput error="Paid prices start at $2.00, so your society keeps more than half after the Thunderstrux fee." label="Member price" onChange={noop} value="1.50" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <MoneyInput disabled hint="Prices lock once tickets have sold." onChange={noop} value="20.00" />
  </div>
);
