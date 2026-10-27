import { TextArea } from 'thunderstrux';

const col = { display: 'grid', gap: 16, maxWidth: 420 } as const;

export const Default = () => (
  <div style={col}>
    <TextArea
      label="Event description"
      hint="Tell attendees what to expect."
      placeholder="Doors open at 6:30 pm. Black tie."
    />
  </div>
);

export const WithError = () => (
  <div style={col}>
    <TextArea label="Event description" defaultValue="" error="Add a description." />
  </div>
);
