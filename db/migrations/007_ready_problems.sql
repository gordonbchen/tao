-- A problem with no served_at is generated ahead of time and waiting to be shown.
ALTER TABLE problems ADD COLUMN IF NOT EXISTS served_at timestamptz;
UPDATE problems SET served_at = created_at WHERE served_at IS NULL;
CREATE INDEX IF NOT EXISTS problems_ready_idx ON problems(subject_id, created_at) WHERE served_at IS NULL;
