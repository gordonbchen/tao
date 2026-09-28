-- Folders that organize a subject's topics into a tree. Topics stay the leaves; a folder's
-- resources are the union of its topics' links, so folders store only a short summary.
CREATE TABLE IF NOT EXISTS topic_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES topic_groups(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '',
  brief text NOT NULL DEFAULT '',
  -- Hash of the contents the summary was generated from; a different current hash means it is stale.
  summary_basis text NOT NULL DEFAULT '',
  summary_provider text,
  summary_model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS topic_groups_name_idx
  ON topic_groups(subject_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS topic_groups_parent_idx ON topic_groups(parent_id);

ALTER TABLE topics ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES topic_groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS topics_group_idx ON topics(group_id);
