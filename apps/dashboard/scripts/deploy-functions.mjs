#!/usr/bin/env node
/**
 * Deploy Supabase Edge Functions via Management API.
 *
 * Bundles each function in ../../supabase/functions/ (skipping _shared) with
 * esbuild — inlines local relative imports, leaves remote imports
 * (https://esm.sh, https://deno.land, jsr:) as-is — then POSTs the bundled
 * source to /v1/projects/{ref}/functions/{slug}.
 *
 * Required env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF.
 * Optional env: ONLY_FUNCTIONS="name1,name2" to deploy a subset.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "..", "supabase", "functions");

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF =
  process.env.SUPABASE_PROJECT_REF ||
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!TOKEN || !REF) {
  console.log("[deploy-fns] Skipping — SUPABASE_ACCESS_TOKEN or project ref not set.");
  console.log("[deploy-fns]   To enable auto-deploy of edge functions, add SUPABASE_ACCESS_TOKEN");
  console.log("[deploy-fns]   to your Vercel env vars (https://supabase.com/dashboard/account/tokens).");
  process.exit(0);
}

const onlyList = (process.env.ONLY_FUNCTIONS ?? "").split(",").filter(Boolean);

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function bundleFunction(name) {
  const entry = path.join(FUNCTIONS_DIR, name, "index.ts");
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "deno1",
    write: false,
    legalComments: "none",
    // Treat any non-relative import as external — Deno will resolve them at runtime.
    plugins: [{
      name: "deno-externals",
      setup(build) {
        // Externalize everything EXCEPT relative imports (./ and ../).
        // Entry point has empty importer — never externalize it.
        build.onResolve({ filter: /.*/ }, (args) => {
          if (!args.importer) return null; // entry
          if (args.path.startsWith("./") || args.path.startsWith("../")) {
            return null; // let esbuild bundle these
          }
          return { path: args.path, external: true };
        });
      },
    }],
  });
  let body = result.outputFiles[0].text;
  // esbuild prepends a "// path/to/source.ts" header comment that Supabase's
  // function-upload pipeline mangles (strips the "// "), turning the path into
  // bare invalid code on line 1 and producing BOOT_ERROR. Strip it ourselves.
  body = body.replace(/^\/\/\s+[^\n]*\.ts\n/, "");
  return body;
}

async function deployFunction(name, body) {
  const slug = name;
  const verifyJwt = name === "telegram-webhook" ? false : true;
  const endpoint = `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;

  // Modern multipart upload (same path the Supabase CLI uses). The legacy
  // JSON-body endpoint strips the first 4-5 bytes of `body`, causing BOOT_ERROR.
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [JSON.stringify({
        name: slug,
        entrypoint_path: "index.ts",
        verify_jwt: verifyJwt,
      })],
      { type: "application/json" },
    ),
  );
  form.append("file", new Blob([body], { type: "application/typescript" }), "index.ts");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${endpoint} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return `deployed: ${slug}`;
}

async function main() {
  const entries = await readdir(FUNCTIONS_DIR);
  const candidates = [];
  for (const e of entries) {
    if (e.startsWith("_")) continue;
    if (onlyList.length > 0 && !onlyList.includes(e)) continue;
    if (!(await isDir(path.join(FUNCTIONS_DIR, e)))) continue;
    candidates.push(e);
  }
  candidates.sort();
  console.log(`[deploy-fns] Deploying ${candidates.length} function(s): ${candidates.join(", ")}`);

  for (const name of candidates) {
    process.stdout.write(`[deploy-fns] ${name}... `);
    try {
      const body = await bundleFunction(name);
      const result = await deployFunction(name, body);
      console.log(result);
    } catch (e) {
      console.error(`FAILED:`, e.message);
      process.exit(1);
    }
  }
  console.log("[deploy-fns] Done.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
