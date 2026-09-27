ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS coverage_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS summary_status text NOT NULL DEFAULT 'not_generated'
    CHECK (summary_status IN ('not_generated', 'pending', 'complete', 'failed')),
  ADD COLUMN IF NOT EXISTS summary_provider text,
  ADD COLUMN IF NOT EXISTS summary_model text;

CREATE TABLE IF NOT EXISTS topic_resources (
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, resource_id)
);
CREATE INDEX IF NOT EXISTS topic_resources_resource_idx ON topic_resources(resource_id, topic_id);
