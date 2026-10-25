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
    <MoneyInput error="Enter a price of $0.50 or more." label="Member price" onChange={noop} value="0.2" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <MoneyInput disabled hint="Prices lock once tickets have sold." onChange={noop} value="20.00" />
  </div>
);
