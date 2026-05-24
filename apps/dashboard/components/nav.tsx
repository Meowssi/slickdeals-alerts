"use client";

import { useState } from "react";
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
  const [open, setOpen] = useState(false);

  const tabs = isAdmin
    ? [...TABS, { href: "/admin", label: "Admin" }]
    : TABS;

  function isActive(href: string): boolean {
    return href === "/" ? path === "/" : path.startsWith(href);
  }

  async function signOut() {
    const supa = supabaseBrowser();
    await supa.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-5xl px-4 py-3">
        {/* Top row: brand (always) + desktop tabs + desktop trailing controls + mobile hamburger */}
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="font-semibold text-brand-600 dark:text-brand-400 whitespace-nowrap">
            Slickdeals Alerts
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex gap-1">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={
                  "px-3 py-1.5 rounded-md text-sm " +
                  (isActive(t.href)
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800")
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {/* Desktop trailing */}
          <div className="hidden md:flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
            <ThemeToggle />
            <span className="hidden lg:inline truncate max-w-[180px]">{email}</span>
            <button
              onClick={signOut}
              className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 whitespace-nowrap"
            >
              Sign out
            </button>
          </div>

          {/* Mobile trailing: theme + hamburger */}
          <div className="flex md:hidden items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
            >
              {open ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {open && (
          <nav className="md:hidden mt-3 -mx-4 px-4 pt-3 pb-2 border-t border-neutral-200 dark:border-neutral-800 space-y-0.5">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                onClick={() => setOpen(false)}
                className={
                  "block px-3 py-2.5 rounded-md text-sm " +
                  (isActive(t.href)
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400 font-medium"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800")
                }
              >
                {t.label}
              </Link>
            ))}
            <div className="pt-2 mt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{email}</span>
              <button
                onClick={signOut}
                className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 px-3 py-1.5"
              >
                Sign out
              </button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
