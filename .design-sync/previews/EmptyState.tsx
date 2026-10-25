import { Button, EmptyState } from 'thunderstrux';

export const NoSales = () => (
  <EmptyState icon="ticket" title="No ticket sales between 1 and 31 March">
    Nothing to chart yet. Sales show here on the day tickets are issued.
  </EmptyState>
);

export const WithAction = () => (
  <EmptyState action={<Button variant="secondary">New event</Button>} icon="calendar" title="No events this week">
    Events and drafts you schedule show here.
  </EmptyState>
);

export const NoMatches = () => (
  <EmptyState
    action={<a className="font-semibold text-brand underline underline-offset-4" href="#">Clear filters</a>}
    icon="search"
    title="No matches"
  >
    Nothing matches these filters. Try a wider range, or anyone.
  </EmptyState>
);
