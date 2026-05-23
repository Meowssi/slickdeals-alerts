import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Slickdeals Alerts",
  description: "Real-time alerts for your Slickdeals saved searches.",
};

// Runs BEFORE first paint to set the html.dark class so users don't see a
// light-to-dark flash on dark-themed sessions. Reads localStorage "theme"
// (set/cleared by ThemeToggle). Falls back to system preference.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = t === 'dark' || (t == null && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
  } catch (_) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
