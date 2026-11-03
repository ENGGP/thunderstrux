import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { adminSearch } from "../search/actions";
import { Panel } from "@/components/admin/record";
import { requirePlatformPage } from "@/lib/platform/authority";

export const metadata: Metadata = { title: "Admin orders" };

// T54: orders are found, never browsed: by reference, id or a Stripe id.
export default async function AdminOrdersPage() {
  const actor = await requirePlatformPage("platform:read", "/admin/orders");
  return (
    <AdminShell actor={actor} current="orders">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Orders</h1>
        <p className="text-sm text-ink-soft">Find one order by its reference, its id, or the Stripe id on the payment.</p>
      </div>
      <form action={adminSearch} className="flex flex-wrap items-end gap-2.5 rounded-[10px] border border-line bg-surface px-4 py-3.5" role="search">
        <label className="flex flex-[1_1_420px] flex-col gap-1.5 font-semibold">
          Reference, order id, cs_, pi_, re_ or du_
          <input className="h-10 rounded-[8px] border border-line-strong bg-surface px-3 font-mono font-normal" name="q" placeholder="7K2Q9D" type="search" />
        </label>
        <button className="min-h-10 rounded-[8px] bg-ink px-3.5 font-semibold text-white" type="submit">Find</button>
      </form>
      <Panel title="Money moves elsewhere">
        <p className="px-4 py-3.5 text-ink-soft">
          Order pages here only read. Refunds happen on the society's own order page or in Stripe's Dashboard, and disputes are answered in Stripe.
        </p>
      </Panel>
    </AdminShell>
  );
}
