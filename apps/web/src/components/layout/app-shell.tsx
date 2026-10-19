"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Ticket,
  CheckSquare,
  FileText,
  MessageSquare,
  Mail,
  Activity,
  Settings,
  Search,
  Sun,
  Moon,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: FolderKanban },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/needs-attention", label: "Needs attention", icon: AlertTriangle },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/prompts", label: "Prompts", icon: MessageSquare },
  { href: "/connections", label: "Gmail", icon: Mail },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings/models", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("mp-theme") as "light" | "dark" | null;
    if (stored) setTheme(stored);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches)
      setTheme("dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("mp-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/health/detail");
        const j = await r.json();
        if (!cancelled) setWorkerOnline(!!j?.worker?.online);
      } catch {
        if (!cancelled) setWorkerOnline(false);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-line bg-bg-panel/60 backdrop-blur-sm">
        <div className="h-14 px-4 flex items-center border-b border-line">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            MailPilot <span className="text-ink-muted">AI</span>
          </Link>
        </div>
        <nav className="px-2 py-3 space-y-0.5">
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm",
                  active
                    ? "bg-brand-subtle text-brand"
                    : "text-ink hover:bg-bg-subtle",
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 mt-4 border-t border-line text-xs text-ink-muted">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                workerOnline === null
                  ? "bg-ink-muted/40"
                  : workerOnline
                    ? "bg-success"
                    : "bg-danger",
              )}
            />
            Worker {workerOnline === null ? "checking…" : workerOnline ? "online" : "offline"}
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-line flex items-center px-4 gap-3">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Search className="w-4 h-4" />
            <input
              type="search"
              placeholder="Search tickets, campaigns, contacts…"
              className="bg-transparent outline-none w-72 placeholder:text-ink-muted/60"
            />
          </div>
          <div className="flex-1" />
          <button
            className="btn-ghost"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              const sb = getBrowserSupabase();
              await sb.auth.signOut();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
