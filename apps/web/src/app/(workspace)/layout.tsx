import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
