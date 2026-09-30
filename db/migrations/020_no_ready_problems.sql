-- Problems are generated only when the student asks, so none wait unserved any more.
DELETE FROM problems WHERE served_at IS NULL;
DROP INDEX IF EXISTS problems_ready_idx;
