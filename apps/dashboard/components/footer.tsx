"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-neutral-500 dark:text-neutral-400 flex flex-wrap items-center gap-4 justify-between">
        <div className="flex gap-4">
          <FooterLink path="/privacy" label="Privacy Policy" />
          <FooterLink path="/terms"   label="Terms of Service" />
          <FooterLink path="/sms-opt-in" label="SMS opt-in" />
        </div>
        <div className="text-neutral-400 dark:text-neutral-500">
          self-hosted{" "}
          <a className="underline hover:text-neutral-600 dark:hover:text-neutral-300" href="https://github.com/Meowssi/slickdeals-alerts" target="_blank" rel="noreferrer">
            slickdeals-alerts
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ path, label }: { path: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Link href={path} className="hover:text-neutral-700 dark:hover:text-neutral-200 hover:underline">
        {label}
      </Link>
      <CopyUrlButton path={path} ariaLabel={`Copy ${label} URL`} />
    </span>
  );
}

export function CopyUrlButton({ path, ariaLabel }: { path: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  async function copy() {
    if (!origin) return;
    const url = origin + path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select and prompt
      window.prompt("Copy this URL:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      title={copied ? "Copied!" : "Copy URL"}
      className="px-1 py-0.5 rounded text-[10px] border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

/**
 * Inline-render a multi-line "paste-ready" text block with the user's actual
 * dashboard origin substituted into any `{ORIGIN}` placeholder. Includes a
 * Copy button.
 */
export function CopyableText({ template, className }: { template: string; className?: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const text = template.replaceAll("{ORIGIN}", origin || "https://your-dashboard");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this text:", text);
    }
  }

  return (
    <div className={"relative rounded bg-neutral-100 border border-neutral-200 " + (className ?? "")}>
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] p-2 pr-16">{text}</pre>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied!" : "Copy"}
        className="absolute top-1 right-1 px-2 py-0.5 rounded text-[10px] bg-white border border-neutral-200 hover:bg-neutral-50"
      >
        {copied ? "✓ copied" : "Copy"}
      </button>
    </div>
  );
}

/** Inline display of the full URL with a copy-paste button next to it. */
export function CopyableUrl({ path, className }: { path: string; className?: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const url = origin ? origin + path : "(loading…)";

  async function copy() {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(origin + path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this URL:", origin + path);
    }
  }

  return (
    <span className={"inline-flex items-center gap-1 rounded bg-neutral-100 border border-neutral-200 px-2 py-1 font-mono text-[11px] " + (className ?? "")}>
      <span className="break-all">{url}</span>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied!" : "Copy"}
        className="shrink-0 px-1 rounded text-[10px] bg-white border border-neutral-200 hover:bg-neutral-50"
      >
        {copied ? "✓ copied" : "Copy"}
      </button>
    </span>
  );
}
