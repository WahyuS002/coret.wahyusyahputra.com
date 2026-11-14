-- The tree. A canvas's drawing lives in R2 at canvas/<id>.json; `pdf` is the R2 key of the PDF it was imported from.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'canvas')),
  pdf TEXT,
  updated TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
