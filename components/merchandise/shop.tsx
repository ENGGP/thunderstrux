"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatPrice } from "@/lib/format";
import {
  addToBasket,
  BASKET_EVENT,
  basketCount,
  LOW_STOCK,
  MAX_LINE_QUANTITY,
  readBasket,
  writeBasket,
  type Basket,
  type BasketLine
} from "@/lib/merchandise/basket";
import type { Quote, ShopProductDetail } from "@/lib/merchandise/shop";

// The basket as stored on this device, kept current across tabs and pages.
export function useBasket() {
  const [basket, setBasket] = useState<Basket | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setBasket(readBasket());
    sync();
    setReady(true);
    window.addEventListener(BASKET_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BASKET_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { basket, ready };
}

const basketHref = (society: string) => `/societies/${society}/merchandise/basket`;
const items = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

export function BasketLink({ society }: { society: string }) {
  const { basket } = useBasket();
  const count = basketCount(basket, society);
  return (
    <Link className="inline-flex min-h-11 items-center gap-2 text-ui font-semibold text-brand underline-offset-4 hover:underline" href={basketHref(society)}>
      <Icon name="bag" size={20} />
      {count ? `Basket · ${items(count)}` : "Basket"}
    </Link>
  );
}

type Option = ShopProductDetail["variants"][number];
const optionName = (option: Pick<Option, "colour" | "size">) => [option.colour, option.size].filter(Boolean).join(", ");

// Photos, option pickers, quantity and Add to basket for one product.
export function ProductPicker({ society, societyName, product }: { society: string; societyName: string; product: ShopProductDetail }) {
  const router = useRouter();
  const { variants } = product;
  const colours = useMemo(() => [...new Set(variants.map((option) => option.colour).filter(Boolean))], [variants]);
  const sizes = useMemo(() => [...new Set(variants.map((option) => option.size).filter(Boolean))], [variants]);
  const first = variants.find((option) => option.available > 0) ?? variants[0];
  const [colour, setColour] = useState(first?.colour ?? "");
  const [size, setSize] = useState(first?.size ?? "");
  const [quantity, setQuantity] = useState(1);
  const [photo, setPhoto] = useState(0);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [otherSociety, setOtherSociety] = useState<string | null>(null);

  const forColour = (value: string) => variants.filter((option) => option.colour === value);
  const sizesHere = colours.length ? sizes.filter((value) => forColour(colour).some((option) => option.size === value)) : sizes;
  const selected = variants.find((option) => option.colour === colour && option.size === size) ?? null;
  const maxQuantity = selected ? Math.min(MAX_LINE_QUANTITY, selected.available) : 0;
  // A price beside each size only when the sizes on offer here cost different amounts.
  const sizePrices = new Set((colours.length ? forColour(colour) : variants).map((option) => option.priceAmount)).size > 1;

  function chooseColour(value: string) {
    setColour(value);
    // Keep the size if this colour has it; otherwise pick its first size in stock.
    const here = forColour(value);
    if (!here.some((option) => option.size === size)) setSize((here.find((option) => option.available > 0) ?? here[0])?.size ?? "");
    setQuantity(1);
    setMessage(null);
  }

  function add(clearFirst = false) {
    if (!selected) return;
    if (clearFirst) writeBasket(null);
    const result = addToBasket(society, selected.id, quantity);
    setOtherSociety(null);
    if (result.ok) {
      setMessage({ tone: "success", text: `Added ${quantity} × ${product.name}${optionName(selected) ? ` (${optionName(selected)})` : ""} to your basket.` });
    } else if (result.reason === "other_society") {
      setOtherSociety(result.society ?? "");
    } else {
      setMessage({
        tone: "warning",
        text: result.reason === "line_full" ? `${MAX_LINE_QUANTITY} is the most of one item in an order.` : "Your basket already has 10 different items, the most an order can hold. Remove one to add this."
      });
    }
  }

  const pill = (on: boolean, off: boolean) =>
    `flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3.5 text-ui ${
      off ? "cursor-not-allowed border-dashed border-line-strong text-ink-muted" : on ? "border-2 border-brand bg-brand-tint px-[13px] font-semibold text-brand-ink" : "border-line-strong text-ink"
    }`;
  const images = product.imageAssetIds;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:items-start">
      <div className="grid gap-3 sm:flex sm:flex-row-reverse sm:items-start sm:gap-4">
        {images.length ? (
          <img
            alt={`${product.name}, photo ${photo + 1} of ${images.length}`}
            className="aspect-[4/5] w-full rounded-card border border-line bg-surface-subtle object-contain sm:flex-1"
            src={`/api/public/assets/${images[photo]}`}
          />
        ) : null}
        {images.length > 1 ? (
          <div aria-label="Product photos" className="flex gap-2 sm:flex-col" role="group">
            {images.map((id, index) => (
              <button
                aria-label={`Show photo ${index + 1} of ${images.length}`}
                aria-pressed={index === photo}
                className={`w-16 overflow-hidden rounded-control border bg-surface-subtle sm:w-20 ${index === photo ? "border-2 border-brand" : "border-line"}`}
                key={id}
                onClick={() => setPhoto(index)}
                type="button"
              >
                <img alt="" className="aspect-[4/5] w-full object-cover" src={`/api/public/assets/${id}`} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid content-start gap-5">
        <div className="grid gap-2">
          <span className="w-fit rounded-tag border border-neutral-border bg-neutral-bg px-2 py-0.5 text-xs font-semibold text-neutral">Pickup only</span>
          <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-4xl">{product.name}</h1>
          <p className="font-display text-2xl font-semibold tabular-nums text-ink">{selected ? formatPrice(selected.priceAmount) : null}</p>
          {product.description ? <p className="whitespace-pre-wrap text-ui text-ink-soft [overflow-wrap:anywhere]">{product.description}</p> : null}
        </div>

        {colours.length ? (
          <fieldset className="grid gap-2.5">
            <legend className="mb-2.5 text-ui font-semibold text-ink">Colour: {colour}</legend>
            <div className="flex flex-wrap gap-2">
              {colours.map((value) => {
                const off = forColour(value).every((option) => option.available === 0);
                return (
                  <label className={pill(value === colour, off)} key={value}>
                    <input checked={value === colour} className="sr-only" disabled={off} name="colour" onChange={() => chooseColour(value)} type="radio" />
                    {value}
                    {off ? " · sold out" : ""}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {sizesHere.length ? (
          <fieldset className="grid gap-2.5">
            <legend className="mb-2.5 text-ui font-semibold text-ink">Size: {size}</legend>
            <div className="flex flex-wrap gap-2">
              {sizesHere.map((value) => {
                const option = variants.find((item) => item.size === value && item.colour === (colours.length ? colour : item.colour));
                const off = !option || option.available === 0;
                return (
                  <label className={pill(value === size, off)} key={value}>
                    <input
                      checked={value === size}
                      className="sr-only"
                      disabled={off}
                      name="size"
                      onChange={() => {
                        setSize(value);
                        setQuantity(1);
                        setMessage(null);
                      }}
                      type="radio"
                    />
                    {value}
                    {off ? " · sold out" : sizePrices && option ? ` · ${formatPrice(option.priceAmount)}` : ""}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {selected && selected.available > 0 && selected.available <= LOW_STOCK ? (
          <p className="text-sm text-ink-soft">{optionName(selected) ? `${optionName(selected)}: ` : ""}only {selected.available} left</p>
        ) : null}

        {selected && selected.available > 0 ? (
          <div className="grid gap-2">
            <span className="text-ui font-semibold text-ink" id="quantity-label">
              Quantity
            </span>
            <div aria-labelledby="quantity-label" className="flex w-fit items-center rounded-control border border-line-strong bg-surface" role="group">
              <button aria-label="One fewer" className="size-11 text-lg font-semibold text-ink disabled:text-ink-muted" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)} type="button">
                −
              </button>
              <span aria-live="polite" className="min-w-9 text-center font-semibold tabular-nums">
                {quantity}
              </span>
              <button aria-label="One more" className="size-11 text-lg font-semibold text-ink disabled:text-ink-muted" disabled={quantity >= maxQuantity} onClick={() => setQuantity(quantity + 1)} type="button">
                +
              </button>
            </div>
          </div>
        ) : null}

        <Button disabled={!selected || selected.available === 0} onClick={() => add()} size="lg">
          {selected && selected.available > 0 ? `Add to basket · ${formatPrice(selected.priceAmount * quantity)}` : "Sold out"}
        </Button>
        {message ? (
          <Notice role="status" tone={message.tone}>
            <p>
              {message.text}{" "}
              {message.tone === "success" ? (
                <Link className="font-semibold text-brand underline underline-offset-4" href={basketHref(society)}>
                  View basket
                </Link>
              ) : null}
            </p>
          </Notice>
        ) : null}
        <p className="text-sm text-ink-soft">Your basket holds {societyName} items only. Prices and stock are checked again when you check out.</p>

        <ConfirmDialog
          cancelLabel="Keep that basket"
          confirmLabel="Clear and add this"
          destructive
          onCancel={() => setOtherSociety(null)}
          onConfirm={() => add(true)}
          open={otherSociety !== null}
          title="Your basket has another society's items"
        >
          <p>A basket holds one society&apos;s merchandise, because each society takes its own payments and runs its own pickups. Check those items out first, or clear them to start a {societyName} basket.</p>
          {otherSociety ? (
            <Link className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={basketHref(otherSociety)} onClick={() => router.refresh()}>
              Go to that basket
            </Link>
          ) : null}
        </ConfirmDialog>
      </div>
    </div>
  );
}

const problemText = { sold_out: "Sold out. Remove it to check out.", reduced: "Fewer are left than you wanted, so we lowered the quantity.", unavailable: "", too_many_lines: "" } as const;

// The basket page: re-quotes on every view and change, never trusting stored prices.
export function BasketView({ society }: { society: string }) {
  const { basket, ready } = useBasket();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [dropped, setDropped] = useState(0);
  // Options whose quantity we lowered to what's left; the note stays after the basket is rewritten.
  const [lowered, setLowered] = useState<Set<string>>(new Set());
  const lines = basket && basket.society === society ? basket.lines : null;
  const key = JSON.stringify(lines);

  const requote = useCallback(async () => {
    const lines: BasketLine[] | null = JSON.parse(key);
    if (!lines?.length) return setQuote(null);
    try {
      const response = await fetchJson<{ quote: Quote }>("/api/merchandise/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ society, items: lines })
      });
      const next = response.quote;
      // Lines no longer sold, or past the limit, leave the basket; lowered quantities stick.
      const gone = new Set(next.problems.filter((item) => item.problem === "unavailable" || item.problem === "too_many_lines").map((item) => item.variantId));
      const reduced = next.problems.filter((item) => item.problem === "reduced").map((item) => item.variantId);
      if (reduced.length) setLowered((current) => new Set([...current, ...reduced]));
      const kept = next.lines.map((line) => ({ variantId: line.variantId, quantity: Math.max(1, line.quantity) }));
      if (gone.size || kept.some((line, index) => line.quantity !== lines[index]?.quantity || line.variantId !== lines[index]?.variantId)) {
        setDropped((count) => count + gone.size);
        writeBasket({ society, lines: kept });
      }
      setQuote(next);
      setError("");
    } catch (failure) {
      setError(failure instanceof ClientApiError && failure.status === 404 ? "This society no longer sells merchandise here." : getClientErrorMessage(failure, "We couldn't check your basket. Try again."));
    }
  }, [key, society]);

  useEffect(() => {
    if (ready) void requote();
  }, [ready, requote]);

  function setQuantity(variantId: string, quantity: number) {
    if (!lines) return;
    writeBasket({ society, lines: quantity > 0 ? lines.map((line) => (line.variantId === variantId ? { ...line, quantity } : line)) : lines.filter((line) => line.variantId !== variantId) });
  }

  if (!ready) return <p className="text-ink-soft" role="status">Checking your basket…</p>;
  if (!lines?.length) {
    return (
      <section className="grid justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
        <h2 className="font-display text-xl font-semibold text-ink">Your basket is empty</h2>
        <p className="text-ink-soft">
          {dropped ? "The items in it are no longer sold. " : ""}Add something from this society&apos;s merchandise. Items you add stay on this device.
        </p>
        <Link className={buttonClasses({ variant: "secondary" })} href={`/societies/${society}/merchandise`}>
          Browse merchandise
        </Link>
      </section>
    );
  }
  if (error) {
    return (
      <Notice role="alert" title="Not checked" tone="danger">
        <p className="mt-0.5">{error}</p>
        <Button className="mt-2" onClick={() => void requote()} variant="secondary">
          Try again
        </Button>
      </Notice>
    );
  }
  if (!quote) return <p className="text-ink-soft" role="status">Checking prices and stock…</p>;

  const problems = new Map<string, keyof typeof problemText>(quote.problems.map((item) => [item.variantId, item.problem]));
  for (const id of lowered) if (!problems.has(id)) problems.set(id, "reduced");
  const soldOut = quote.lines.some((line) => problems.get(line.variantId) === "sold_out");
  const count = quote.lines.reduce((total, line) => total + line.quantity, 0);
  return (
    <div className="grid gap-5">
      {dropped ? (
        <Notice role="status" title="Your basket changed" tone="warning">
          <p className="mt-0.5">{dropped === 1 ? "An item is" : `${dropped} items are`} no longer sold, so we took {dropped === 1 ? "it" : "them"} out. Nothing has been charged.</p>
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:items-start">
        <section aria-label="Items" className="rounded-card border border-line bg-surface px-4 sm:px-6">
          <ul>
            {quote.lines.map((line) => {
              const problem = problems.get(line.variantId);
              const label = `${line.name}${line.option ? `, ${line.option}` : ""}`;
              return (
                <li className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 border-t border-line py-5 first:border-t-0 sm:grid-cols-[88px_minmax(0,1fr)_auto]" key={line.variantId}>
                  {line.coverAssetId ? (
                    <img alt="" className="aspect-[4/5] w-16 rounded-control border border-line bg-surface-subtle object-cover sm:w-[88px]" src={`/api/public/assets/${line.coverAssetId}`} />
                  ) : (
                    <span aria-hidden="true" className="aspect-[4/5] w-16 rounded-control border border-line bg-surface-subtle sm:w-[88px]" />
                  )}
                  <div className="grid min-w-0 content-start gap-1">
                    <Link className="font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]" href={`/societies/${society}/merchandise/${line.productId}`}>
                      {line.name}
                    </Link>
                    <span className="text-sm text-ink-soft">
                      {line.option ? `${line.option} · ` : ""}
                      {line.unitPrice ? `${formatPrice(line.unitPrice)} each` : "Free"}
                    </span>
                    {problem && problemText[problem] ? (
                      <p className={`text-sm ${problem === "sold_out" ? "text-danger" : "text-warning"}`} role="status">
                        {problemText[problem]}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {problem === "sold_out" ? null : (
                        <div aria-label={`Quantity of ${label}`} className="flex items-center rounded-control border border-line-strong bg-surface" role="group">
                          <button aria-label="One fewer" className="h-10 w-11 text-lg font-semibold text-ink disabled:text-ink-muted" disabled={line.quantity <= 1} onClick={() => setQuantity(line.variantId, line.quantity - 1)} type="button">
                            −
                          </button>
                          <span className="min-w-8 text-center font-semibold tabular-nums">{line.quantity}</span>
                          <button
                            aria-label="One more"
                            className="h-10 w-11 text-lg font-semibold text-ink disabled:text-ink-muted"
                            disabled={line.quantity >= Math.min(MAX_LINE_QUANTITY, line.available)}
                            onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      )}
                      <Button aria-label={`Remove ${label}`} onClick={() => setQuantity(line.variantId, 0)} size="sm" variant="tertiary">
                        Remove
                      </Button>
                    </div>
                  </div>
                  <span className="col-start-2 font-semibold tabular-nums sm:col-start-3">{problem === "sold_out" ? "" : formatPrice(line.lineTotal)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <aside aria-labelledby="summary-heading" className="grid gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold text-ink" id="summary-heading">
            Order summary
          </h2>
          <div className="grid gap-2 text-ui tabular-nums">
            <div className="flex justify-between gap-3"><span>{items(count)}</span><span>{formatPrice(quote.total)}</span></div>
            <div className="flex justify-between gap-3 text-ink-soft"><span>Delivery</span><span>None, pickup only</span></div>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-3 text-lg font-semibold tabular-nums"><span>Total</span><span>{formatPrice(quote.total)}</span></div>
          {quote.pickupPolicy ? (
            <div className="grid gap-1 rounded-control bg-surface-subtle p-3.5 text-sm">
              <strong>Pickup</strong>
              <span className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{quote.pickupPolicy}</span>
            </div>
          ) : null}
          {soldOut ? (
            <Button disabled size="lg">Checkout merchandise</Button>
          ) : (
            <Link className={buttonClasses({ size: "lg" })} href={`/societies/${society}/merchandise/checkout`}>
              Checkout merchandise
            </Link>
          )}
          <p className="text-sm text-ink-soft">Prices and stock are checked again when you check out. We hold your items for 30 minutes while you pay.</p>
          {quote.refundPolicy ? <p className="whitespace-pre-wrap text-sm text-ink-soft [overflow-wrap:anywhere]">Refunds: {quote.refundPolicy}</p> : null}
        </aside>
      </div>
      <p className="text-sm text-ink-soft">Up to 10 different items, 10 of each. This basket stays on this device.</p>
    </div>
  );
}
