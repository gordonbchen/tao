-- Archived cards and problems stay in Browse but leave review: no archived card is due, and no archived problem comes back.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS archived_at timestamptz;
