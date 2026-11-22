-- Multiple hero images for news articles.
-- image_url stays the primary hero; hero_images holds the additional
-- hero images in display order, using the same stored-value format as
-- image_url (a news-images storage path, a legacy public URL, or an
-- external URL). Old rows default to an empty list: one hero, as before.
ALTER TABLE public.news_articles
  ADD COLUMN IF NOT EXISTS hero_images jsonb NOT NULL DEFAULT '[]'::jsonb;
