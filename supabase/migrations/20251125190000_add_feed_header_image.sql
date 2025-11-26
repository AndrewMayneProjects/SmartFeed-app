ALTER TABLE public.feed_items
  ADD COLUMN IF NOT EXISTS header_image_url text;

