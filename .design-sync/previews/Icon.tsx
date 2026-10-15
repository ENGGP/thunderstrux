import { Icon } from 'thunderstrux';

const names = ['home', 'calendar', 'receipt', 'ticket', 'users', 'mail', 'card', 'pin', 'search', 'shield', 'info', 'success', 'warning', 'error'] as const;

export const Set = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: 'var(--ts-ink)' }}>
    {names.map((name) => <Icon key={name} name={name} size={24} />)}
  </div>
);
