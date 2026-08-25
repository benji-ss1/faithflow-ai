-- 2026-08-25 — Bible verse full-text (FTS) index for hybrid quote→verse search
--
-- Adds the lexical arm of hybrid search (src/lib/server/bible.ts → lexicalSearch
-- / hybridSearch). Without this GIN index a websearch_to_tsquery over the full
-- Bible does a sequential scan (~3s on the ~222k-verse KJV in dev); with it the
-- same query runs in ~13ms. hybridSearch RRF-fuses this lexical rank with the
-- existing pgvector semantic search so an exact quotation ("the Lord is my
-- shepherd") ranks its verse first while a paraphrase still resolves via vectors.
--
-- SAFE TO RUN LIVE: CONCURRENTLY builds the index WITHOUT taking a write lock on
-- bible_verses, so search/lookup keep serving during the ~seconds-to-minutes
-- build. CONCURRENTLY cannot run inside a transaction block — run this statement
-- on its own (do NOT wrap in BEGIN/COMMIT), which is why it lives here as a
-- manual migration rather than in ./drizzle (drizzle wraps migrations in a txn).
-- Idempotent via IF NOT EXISTS. Expression must match lexicalSearch EXACTLY
-- (to_tsvector('english', text)) or the planner won't use the index.
--
-- Apply to production (Supabase project mdjdemrtykflfucggbqt, eu-west-1) with
-- the user's explicit OK — via the Supabase MCP or psql. Recorded here for
-- reproducibility.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bible_verses_fts
  ON bible_verses
  USING gin (to_tsvector('english', text));

-- Verify the planner uses it:
--   EXPLAIN ANALYZE
--   SELECT book, chapter, verse
--   FROM bible_verses
--   WHERE translation_id = '<KJV id>'
--     AND to_tsvector('english', text) @@ websearch_to_tsquery('english', 'the lord is my shepherd')
--   ORDER BY ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', 'the lord is my shepherd')) DESC
--   LIMIT 5;
--   -- expect a Bitmap Index Scan on idx_bible_verses_fts, not a Seq Scan.
