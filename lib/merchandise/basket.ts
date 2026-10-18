// The merchandise basket (T26, design round B2): one society's options and
// quantities, kept on this device only. Prices, names and stock are never
// stored; every view re-quotes them from the server. Safe for the browser.

export const MAX_BASKET_LINES = 10;
export const MAX_LINE_QUANTITY = 10;
// Below this many left, buyers see "Only N left".
export const LOW_STOCK = 5;

export type BasketLine = { variantId: string; quantity: number };
export type Basket = { society: string; lines: BasketLine[] };

const KEY = "thunderstrux:merchandise-basket";
export const BASKET_EVENT = "thunderstrux:basket-changed";

const valid = (value: unknown): value is Basket =>
  !!value &&
  typeof (value as Basket).society === "string" &&
  Array.isArray((value as Basket).lines) &&
  (value as Basket).lines.every((line) => typeof line?.variantId === "string" && Number.isInteger(line.quantity) && line.quantity > 0);

export function readBasket(): Basket | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return valid(parsed) && parsed.lines.length ? parsed : null;
  } catch {
    // Private windows and blocked storage: behave as an empty basket.
    return null;
  }
}

export function writeBasket(basket: Basket | null) {
  try {
    if (basket?.lines.length) window.localStorage.setItem(KEY, JSON.stringify(basket));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the basket lasts only for this page.
  }
  window.dispatchEvent(new Event(BASKET_EVENT));
}

export type AddResult = { ok: true } | { ok: false; reason: "other_society" | "too_many_lines" | "line_full"; society?: string };

// Adds to one society's basket: the same option merges, ten of one option and
// ten different options at most. Another society's basket is never mixed in.
export function addToBasket(society: string, variantId: string, quantity: number): AddResult {
  const current = readBasket();
  if (current && current.society !== society) return { ok: false, reason: "other_society", society: current.society };
  const lines = current?.lines ?? [];
  const existing = lines.find((line) => line.variantId === variantId);
  if (!existing && lines.length >= MAX_BASKET_LINES) return { ok: false, reason: "too_many_lines" };
  if (existing && existing.quantity >= MAX_LINE_QUANTITY) return { ok: false, reason: "line_full" };
  const next = existing
    ? lines.map((line) => (line.variantId === variantId ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + quantity) } : line))
    : [...lines, { variantId, quantity: Math.min(MAX_LINE_QUANTITY, quantity) }];
  writeBasket({ society, lines: next });
  return { ok: true };
}

export const basketCount = (basket: Basket | null, society: string) =>
  basket && basket.society === society ? basket.lines.reduce((total, line) => total + line.quantity, 0) : 0;
