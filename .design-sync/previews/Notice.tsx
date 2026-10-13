import { Notice } from 'thunderstrux';

export const Tones = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
    <Notice tone="info" title="Tickets go on sale Friday">Your society can publish the event when it is ready.</Notice>
    <Notice tone="success" role="status" title="Payment received">A confirmation has been emailed to you.</Notice>
    <Notice tone="warning" title="Verify your email">Check your inbox to finish setting up your account.</Notice>
    <Notice tone="danger" role="alert" title="Payment failed">Your card was declined. Try another card.</Notice>
  </div>
);

export const WithoutTitle = () => (
  <div style={{ maxWidth: 480 }}>
    <Notice>Changes are saved automatically.</Notice>
  </div>
);
