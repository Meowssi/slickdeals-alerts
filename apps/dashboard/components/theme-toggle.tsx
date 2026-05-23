"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = (localStorage.getItem("theme") as Theme | null);
    setTheme(stored ?? "system");
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", prefersDark);
    } else {
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
    }
  }

  // Render a static placeholder until hydration so the SSR'd output stays
  // consistent with the early-paint script (no mismatch).
  if (!mounted) {
    return <div className="w-7 h-7" aria-hidden />;
  }

  function cycle() {
    if (theme === "light") applyTheme("dark");
    else if (theme === "dark") applyTheme("system");
    else applyTheme("light");
  }

  const label =
    theme === "light" ? "Light · click for dark"
    : theme === "dark"  ? "Dark · click for system"
    : "System · click for light";

  const icon =
    theme === "light" ? "☀️"
    : theme === "dark"  ? "🌙"
    : "🖥️";

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-md text-sm flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
    >
      {icon}
    </button>
  );
}
