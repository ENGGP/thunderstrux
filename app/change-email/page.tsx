import { EmailChangeConfirmForm } from "@/components/auth/email-change-confirm-form";
export const metadata = { title: "Confirm email change", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ChangeEmailPage() {
  return <main className="mx-auto grid max-w-lg gap-5 px-4 py-10"><h1 className="text-2xl font-semibold">Confirm email change</h1><p>Opening this page does not change your email. Confirmation signs out all devices.</p><EmailChangeConfirmForm /></main>;
}
