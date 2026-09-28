-- Student-chosen order of folders and topics within their parent. Siblings of both kinds sort
-- together by position; new rows default to the current time, which places them last.
ALTER TABLE topic_groups ADD COLUMN IF NOT EXISTS position double precision;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS position double precision;
-- Keep the previous order: folders by name first, then topics by creation time.
UPDATE topic_groups g SET position = ranked.n FROM (
  SELECT id, row_number() OVER (PARTITION BY subject_id, parent_id ORDER BY lower(name), created_at) AS n FROM topic_groups
) ranked WHERE g.id = ranked.id AND g.position IS NULL;
UPDATE topics SET position = extract(epoch FROM created_at) WHERE position IS NULL;
ALTER TABLE topic_groups ALTER COLUMN position SET DEFAULT extract(epoch FROM clock_timestamp()), ALTER COLUMN position SET NOT NULL;
ALTER TABLE topics ALTER COLUMN position SET DEFAULT extract(epoch FROM clock_timestamp()), ALTER COLUMN position SET NOT NULL;
