import { TextInput } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 380 } as const;

export const Default = () => (
  <div style={col}>
    <TextInput label="Email address" type="email" placeholder="you@uni.edu.au" />
    <TextInput label="Society name" defaultValue="Chess Society" hint="Shown on your public page." />
  </div>
);

export const WithError = () => (
  <div style={col}>
    <TextInput label="Email address" type="email" defaultValue="alex@" error="Enter a valid email address." />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <TextInput label="Organisation URL" defaultValue="chess-society" disabled />
  </div>
);
