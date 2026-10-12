import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";

// Presentation only: no authentication, context or data loading happens here.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
