-- ProPresenter parity (Wave 3, item 3b) — a colour label per Library.
-- Additive + idempotent. Safe to run repeatedly.
--
-- ORDERING (required): APPLY THIS MIGRATION BEFORE THE APP CODE DEPLOYS.
-- listLibraries() does db.select() over the libraries table, which lists every
-- schema column (incl. the new `color`). If the column is missing at query time
-- that read errors. A NULL colour is fine (rendered as "no label" in the rail);
-- an ABSENT column is not — so migrate first, same rule as every prior column.

ALTER TABLE libraries
  ADD COLUMN IF NOT EXISTS color text;

-- rollback:
--   ALTER TABLE libraries DROP COLUMN IF EXISTS color;
