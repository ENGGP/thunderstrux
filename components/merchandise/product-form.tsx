"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";
import type { StaffProduct } from "@/lib/merchandise/catalogue";
import { isBelowStripeMinimum, paidPriceMinimum } from "@/lib/stripe/fees";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 5 * 1024 * 1024;
const maxPhotos = 4;

type Option = { key: string; id?: string; expectedVersion?: number; colour: string; size: string; sku: string; price: string; remaining: string };
let nextKey = 0;
const blankOption = (): Option => ({ key: `new-${(nextKey += 1)}`, colour: "", size: "", sku: "", price: "", remaining: "" });

const cell = "h-11 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 text-base text-ink aria-[invalid]:border-danger disabled:bg-surface-subtle";

// The product editor (T25, design round B2): details, up to four photos, the
// options buyers pick with price and stock, and the society's pickup details.
// Publishing lives beside it; the server re-checks everything under locks.
export function ProductForm({
  orgSlug,
  product,
  pickupPolicy,
  archived = false
}: {
  orgSlug: string;
  product?: StaffProduct;
  pickupPolicy: string;
  archived?: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const initial = {
    name: product?.name ?? "",
    description: product?.description ?? "",
    images: product?.imageAssetIds ?? [],
    options: product?.variants.length
      ? product.variants.map((variant) => ({
          key: variant.id,
          id: variant.id,
          expectedVersion: variant.version,
          colour: variant.colour,
          size: variant.size,
          sku: variant.sku,
          price: formatMoneyInput(variant.priceAmount),
          remaining: String(variant.remaining)
        }))
      : [blankOption()]
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const dirty = JSON.stringify(form) !== saved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(values: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...values }));
    setMessage("");
  }
  function setOption(index: number, values: Partial<Option>) {
    update({ options: form.options.map((option, at) => (at === index ? { ...option, ...values } : option)) });
  }

  async function addPhoto(file?: File) {
    if (!file) return;
    if (!imageTypes.includes(file.type)) return setUpload({ busy: false, error: "Use a JPG, PNG or WebP image." });
    if (file.size > maxImageBytes) return setUpload({ busy: false, error: "That photo is larger than 5 MB. Choose a smaller one." });
    setUpload({ busy: true });
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetchJson<{ asset: { id: string } }>(`/api/orgs/${orgSlug}/assets?kind=product`, { method: "POST", body });
      setForm((current) => ({ ...current, images: [...current.images, response.asset.id] }));
      setUpload({ busy: false });
    } catch (failure) {
      setUpload({ busy: false, error: getClientErrorMessage(failure, "The photo could not be uploaded. Try again.") });
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = "Give the product a name.";
    const variants = form.options.map((option, index) => {
      const priceAmount = parseMoneyInput(option.price);
      const remaining = /^\s*\d{1,6}\s*$/.test(option.remaining) ? Number(option.remaining) : null;
      if (priceAmount === null) found[`variants.${index}.priceAmount`] = "Enter an amount like 45.00. Use 0 for free.";
      else if (isBelowStripeMinimum(priceAmount)) found[`variants.${index}.priceAmount`] = paidPriceMinimum;
      if (remaining === null) found[`variants.${index}.remaining`] = "Enter a whole number, 0 or more.";
      return { id: option.id, expectedVersion: option.expectedVersion, colour: option.colour, size: option.size, sku: option.sku, priceAmount: priceAmount ?? 0, remaining: remaining ?? 0 };
    });
    if (Object.keys(found).length) {
      setErrors(found);
      setError("Fix the highlighted fields, then save.");
      return;
    }
    setBusy(true);
    setErrors({});
    setError("");
    setConflict(false);
    const body = { name: form.name, description: form.description, imageAssetIds: form.images, variants };
    try {
      const response = await fetchJson<{ product: { id: string } }>(product ? `/api/orgs/${orgSlug}/merchandise/${product.id}` : `/api/orgs/${orgSlug}/merchandise`, {
        method: product ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product ? { ...body, expectedVersion: product.version } : body)
      });
      setSaved(JSON.stringify(form));
      if (product) {
        setMessage("Product saved.");
        router.refresh();
      } else {
        router.push(`/dashboard/merchandise/${response.product.id}`);
      }
    } catch (failure) {
      const details = failure instanceof ClientApiError ? (failure.payload?.error?.details ?? []) : [];
      setErrors(Object.fromEntries(details.filter((detail) => detail.path?.length).map((detail) => [detail.path!.join("."), detail.message])));
      setConflict(failure instanceof ClientApiError && failure.status === 409 && /changed since you opened/.test(failure.payload?.error?.message ?? ""));
      setError(getClientErrorMessage(failure, "Unable to save the product."));
    } finally {
      setBusy(false);
    }
  }

  const removeLabel = product?.everPublished ? "Stop selling" : "Remove";
  return (
    <form className="grid gap-5" noValidate onSubmit={save}>
      <Card>
        <fieldset className="grid gap-4" disabled={archived}>
          <legend className="mb-4 font-display text-xl font-semibold text-ink">Details</legend>
          <TextInput error={errors.name} id="name" label="Name" maxLength={120} onChange={(event) => update({ name: event.target.value })} value={form.name} />
          <TextArea
            error={errors.description}
            hint="Optional. Say what it's made of and how it fits."
            id="description"
            label="Description"
            maxLength={2000}
            onChange={(event) => update({ description: event.target.value })}
            value={form.description}
          />
        </fieldset>
      </Card>

      <Card>
        <fieldset className="grid gap-4" disabled={archived} id="images">
          <legend className="mb-4 font-display text-xl font-semibold text-ink">Photos</legend>
          <ul className="flex flex-wrap gap-3">
            {form.images.map((id, index) => (
              <li className="grid w-24 justify-items-center gap-1" key={id}>
                <img
                  alt={`${form.name || "Product"}, photo ${index + 1} of ${form.images.length}`}
                  className="aspect-[4/5] w-24 rounded-control border border-line bg-surface-subtle object-cover"
                  src={`/api/orgs/${orgSlug}/assets/${id}`}
                />
                <span className="text-xs font-semibold text-ink-muted">{index === 0 ? "Cover" : `Photo ${index + 1}`}</span>
                <div className="flex">
                  {index > 0 ? (
                    <Button
                      aria-label={`Make photo ${index + 1} the cover`}
                      onClick={() => update({ images: [id, ...form.images.filter((other) => other !== id)] })}
                      size="sm"
                      type="button"
                      variant="tertiary"
                    >
                      Cover
                    </Button>
                  ) : null}
                  <Button aria-label={`Remove photo ${index + 1}`} onClick={() => update({ images: form.images.filter((other) => other !== id) })} size="sm" type="button" variant="tertiary">
                    Remove
                  </Button>
                </div>
              </li>
            ))}
            {upload.busy ? (
              <li className="flex aspect-[4/5] w-24 items-center justify-center rounded-control border border-line bg-surface-subtle text-sm text-ink-soft" role="status">
                Uploading…
              </li>
            ) : null}
          </ul>
          <input
            accept={imageTypes.join(",")}
            // The visible button opens it; hidden so it is not a second, unlabelled control.
            className="hidden"
            onChange={(event) => {
              void addPhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={fileInput}
            type="file"
          />
          {form.images.length < maxPhotos ? (
            <div>
              <Button disabled={upload.busy} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                Add photo
              </Button>
            </div>
          ) : null}
          <p className="text-sm text-ink-muted">Up to 4 photos. JPG, PNG or WebP up to 5 MB. Shown at 4:5; the first is the cover.</p>
          {upload.error ?? errors.imageAssetIds ?? errors.images ? (
            <p className="text-sm text-danger" role="alert">
              {upload.error ?? errors.imageAssetIds ?? errors.images}
            </p>
          ) : null}
        </fieldset>
      </Card>

      <Card>
        <fieldset className="grid gap-4" disabled={archived} id="variants">
          <legend className="mb-1 font-display text-xl font-semibold text-ink">Options and stock</legend>
          <p className="text-sm text-ink-soft">
            Each option is one thing a buyer picks, like Navy, L. Leave colour and size blank for a one-option product. Stock is what&apos;s left to sell.
          </p>
          <ul className="grid gap-3">
            {form.options.map((option, index) => {
              const label = [option.colour, option.size].filter(Boolean).join(", ") || `option ${index + 1}`;
              const fieldError = (field: string) => errors[`variants.${index}.${field}`];
              const rowErrors = ["colour", "size", "sku", "priceAmount", "remaining"].map(fieldError).filter(Boolean);
              return (
                <li className="grid gap-2 rounded-control border border-line p-3" key={option.key}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:items-end">
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                      <span>Colour</span>
                      <input aria-invalid={fieldError("colour") ? true : undefined} className={cell} maxLength={40} onChange={(event) => setOption(index, { colour: event.target.value })} value={option.colour} />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                      <span>Size</span>
                      <input aria-invalid={fieldError("size") ? true : undefined} className={cell} maxLength={40} onChange={(event) => setOption(index, { size: event.target.value })} value={option.size} />
                    </label>
                    <label className="col-span-2 grid gap-1 text-sm font-semibold text-ink md:col-span-1">
                      <span>SKU</span>
                      <input
                        aria-invalid={fieldError("sku") ? true : undefined}
                        className={`${cell} uppercase`}
                        maxLength={64}
                        onChange={(event) => setOption(index, { sku: event.target.value })}
                        placeholder="Made for you"
                        value={option.sku}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                      <span>Price</span>
                      <span className="flex h-11 items-center rounded-control border border-line-strong bg-surface has-[[aria-invalid]]:border-danger has-[:disabled]:bg-surface-subtle">
                        <span aria-hidden="true" className="pl-3 font-normal text-ink-soft">$</span>
                        <input
                          aria-invalid={fieldError("priceAmount") ? true : undefined}
                          className="h-full w-full min-w-0 bg-transparent px-2 text-base font-normal text-ink"
                          inputMode="decimal"
                          onChange={(event) => setOption(index, { price: event.target.value })}
                          placeholder="0.00"
                          value={option.price}
                        />
                      </span>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                      <span>Stock left</span>
                      <input aria-invalid={fieldError("remaining") ? true : undefined} className={cell} inputMode="numeric" onChange={(event) => setOption(index, { remaining: event.target.value })} value={option.remaining} />
                    </label>
                    {form.options.length > 1 ? (
                      <Button
                        aria-label={`${removeLabel} ${label}`}
                        className="col-span-2 justify-self-start md:col-span-1 md:mb-1"
                        onClick={() => update({ options: form.options.filter((_other, at) => at !== index) })}
                        size="sm"
                        type="button"
                        variant="tertiary"
                      >
                        {removeLabel}
                      </Button>
                    ) : <span />}
                  </div>
                  {rowErrors.length ? (
                    <p className="text-sm text-danger" role="alert">
                      {rowErrors.join(" ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {errors.variants ? <p className="text-sm text-danger" role="alert">{errors.variants}</p> : null}
          <p className="text-sm text-ink-soft">
            {product?.everPublished
              ? "This product has been on sale, so an option you take away stops selling instead of disappearing; receipts keep its details."
              : "Leave a SKU blank and we'll make one from the name, colour and size."}
          </p>
          {form.options.length < 50 ? (
            <div>
              <Button onClick={() => update({ options: [...form.options, blankOption()] })} type="button" variant="secondary">
                Add option
              </Button>
            </div>
          ) : null}
        </fieldset>
      </Card>

      <Card>
        <div className="grid gap-2" id="pickup">
          <h2 className="font-display text-xl font-semibold text-ink">Pickup</h2>
          {pickupPolicy ? (
            <p className="whitespace-pre-wrap text-ui text-ink [overflow-wrap:anywhere]">{pickupPolicy}</p>
          ) : (
            <p className="text-ui text-warning">No pickup details yet. Products can&apos;t go on sale until buyers know where to collect.</p>
          )}
          <p className="text-sm text-ink-soft">
            Your society&apos;s pickup details, shown with every product.{" "}
            <Link className="font-semibold text-brand underline underline-offset-4" href="/dashboard/settings/profile">
              Change in Society profile
            </Link>
          </p>
        </div>
      </Card>

      {conflict ? (
        <Notice role="alert" title="This product changed since you opened it" tone="warning">
          <p className="mt-0.5">{error} Your edits are still in the form.</p>
          <Button className="mt-2" onClick={() => window.location.reload()} type="button" variant="secondary">
            Reload product
          </Button>
        </Notice>
      ) : error ? (
        <Notice role="alert" title="Not saved" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      {message ? (
        <Notice role="status" tone="success">
          <p>{message}</p>
        </Notice>
      ) : null}

      {archived ? null : (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || upload.busy} size="lg" type="submit">
            {product ? "Save changes" : "Save draft"}
          </Button>
          <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href="/dashboard/merchandise">
            {product ? "Back to products" : "Cancel"}
          </Link>
        </div>
      )}
    </form>
  );
}
