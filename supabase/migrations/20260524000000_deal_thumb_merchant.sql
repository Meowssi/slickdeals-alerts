-- Capture richer per-deal metadata from Slickdeals RSS:
--   * thumb_score      — community vote score (Thumb Score: +N)
--   * merchant         — store slug from data-store-slug (e.g. "amazon")
--   * merchant_domain  — exit domain from data-product-exitWebsite (e.g. "amazon.com")
-- Existing `store` column kept for backwards-compat — it's the (often-wrong)
-- regex from the title. Display layer should prefer merchant_domain → merchant → store.

alter table public.deals
  add column if not exists thumb_score     int,
  add column if not exists merchant        text,
  add column if not exists merchant_domain text;

create index if not exists deals_thumb_score_idx on public.deals (thumb_score)
  where thumb_score is not null;
create index if not exists deals_merchant_idx    on public.deals (merchant)
  where merchant is not null;
