"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";

const TABS = [
  { href: "/",         label: "Feed" },
  { href: "/alerts",   label: "Alerts" },
  { href: "/stats",    label: "Stats" },
  { href: "/feedback", label: "Feedback" },
  { href: "/settings", label: "Settings" },
  { href: "/setup",    label: "Setup" },
];

export function Nav({ email, isAdmin = false }: { email: string; isAdmin?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const tabs = isAdmin
    ? [...TABS, { href: "/admin", label: "Admin" }]
    : TABS;

  async function signOut() {
    const supa = supabaseBrowser();
    await supa.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold text-brand-600 dark:text-brand-400">
            Slickdeals Alerts
          </Link>
          <nav className="flex gap-1">
            {tabs.map((t) => {
              const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={
                    "px-3 py-1.5 rounded-md text-sm " +
                    (active
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800")
                  }
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
          <ThemeToggle />
          <span className="hidden sm:inline">{email}</span>
          <button onClick={signOut} className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
