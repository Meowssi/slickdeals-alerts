// Intentionally empty barrel.
//
// Consumers must use subpath imports so that the package works in both
// Next.js's webpack/turbopack bundler AND the poller's NodeNext resolution:
//   import { parseRss } from "@slickalerts/shared/rss";
//   import { PROVIDER_CATALOG } from "@slickalerts/shared/providers";
//   import type { DealItem } from "@slickalerts/shared/types";
//
// Bundler resolution is happy with extensionless relative re-exports here,
// but NodeNext is strict and requires explicit extensions for relative
// specifiers. Forcing subpath imports avoids the conflict entirely.
export {};
