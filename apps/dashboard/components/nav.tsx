"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const TABS = [
  { href: "/",         label: "Feed" },
  { href: "/alerts",   label: "Alerts" },
  { href: "/stats",    label: "Stats" },
  { href: "/settings", label: "Settings" },
  { href: "/setup",    label: "Setup" },
];

export function Nav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();

  async function signOut() {
    const supa = supabaseBrowser();
    await supa.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold text-brand-600">
            Slickdeals Alerts
          </Link>
          <nav className="flex gap-1">
            {TABS.map((t) => {
              const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={
                    "px-3 py-1.5 rounded-md text-sm " +
                    (active
                      ? "bg-brand-50 text-brand-700"
                      : "text-neutral-600 hover:bg-neutral-100")
                  }
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <span className="hidden sm:inline">{email}</span>
          <button onClick={signOut} className="text-neutral-500 hover:text-neutral-900">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
