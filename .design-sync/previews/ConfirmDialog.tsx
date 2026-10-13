import { ConfirmDialog } from 'thunderstrux';

const noop = () => {};

export const Confirm = () => (
  <ConfirmDialog open title="Publish this event?" confirmLabel="Publish event" onConfirm={noop} onCancel={noop}>
    <p>Spring Ball 2027 will become visible to everyone and tickets can be bought straight away.</p>
  </ConfirmDialog>
);

export const Destructive = () => (
  <ConfirmDialog open destructive title="Delete this event?" confirmLabel="Delete event" onConfirm={noop} onCancel={noop}>
    <p>This permanently removes the event and its ticket types. Paid orders are not affected.</p>
  </ConfirmDialog>
);

export const Busy = () => (
  <ConfirmDialog open busy destructive title="Close your account?" confirmLabel="Closing…" onConfirm={noop} onCancel={noop}>
    <p>We are closing your account. This may take a few seconds.</p>
  </ConfirmDialog>
);
