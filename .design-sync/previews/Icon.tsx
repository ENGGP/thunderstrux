import { Icon } from 'thunderstrux';

const names = ['home', 'calendar', 'receipt', 'ticket', 'users', 'mail', 'card', 'pin', 'search', 'shield', 'info', 'success', 'warning', 'error'] as const;

export const Set = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 72px)', gap: 16, color: 'var(--ts-ink)' }}>
    {names.map((name) => (
      <div key={name} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
        <Icon name={name} size={24} />
        <span className="text-xs text-ink-soft">{name}</span>
      </div>
    ))}
  </div>
);

export const InContext = () => (
  <div className="text-ink-soft" style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="calendar" />23 Oct 2026, 6:00 pm</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="pin" />Union Courtyard</span>
  </div>
);
