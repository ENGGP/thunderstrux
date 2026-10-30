// How long a checkout holds what it sells while the buyer pays (PAY-009). As on
// Humanitix: 20 minutes unless an event chooses 5 to 59. Shop and membership
// checkouts hold for the default. No server imports, so pages and forms read it too.
export const defaultHoldMinutes = 20;
export const minHoldMinutes = 5;
export const maxHoldMinutes = 59;
export const commerceHoldMinutes = defaultHoldMinutes;

export function holdEndsAt(start: Date, minutes: number) {
  return new Date(start.getTime() + minutes * 60_000);
}
