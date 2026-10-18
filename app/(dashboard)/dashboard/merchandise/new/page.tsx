import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/components/merchandise/product-form";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readProfile } from "@/lib/organisations/profile";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const organisation = await requireManagementPage("merchandise:manage", "/dashboard/merchandise/new");
  const pickupPolicy = (await readProfile(organisation.id))?.pickupPolicy ?? "";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Merchandise", href: "/dashboard/merchandise" }]} title="New product" />
      <div className="grid max-w-3xl gap-4">
        <ProductForm orgSlug={organisation.slug} pickupPolicy={pickupPolicy} />
        <p className="text-sm text-ink-soft">Save the draft first. The publish check and a preview appear next.</p>
      </div>
    </DashboardShell>
  );
}
