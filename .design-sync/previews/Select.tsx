import { Select } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 380 } as const;

export const Default = () => (
  <div style={col}>
    <Select label="Ticket type" hint="Choose how many people this ticket admits." defaultValue="standard">
      <option value="standard">Standard</option>
      <option value="early">Early bird</option>
      <option value="vip">VIP</option>
    </Select>
  </div>
);

export const WithError = () => (
  <div style={col}>
    <Select label="Ticket type" defaultValue="" error="Select a ticket type.">
      <option value="">Select…</option>
      <option value="standard">Standard</option>
    </Select>
  </div>
);
