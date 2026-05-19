import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slickdeals Alerts",
  description: "Real-time alerts for your Slickdeals saved searches.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
