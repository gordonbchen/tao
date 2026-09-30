-- The tutor chat also covers topics, folders, and resources, outside practice.
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES topics(id) ON DELETE CASCADE;
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES topic_groups(id) ON DELETE CASCADE;
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS resource_id uuid REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE tutor_messages DROP CONSTRAINT IF EXISTS tutor_messages_one_parent;
ALTER TABLE tutor_messages ADD CONSTRAINT tutor_messages_one_parent CHECK (num_nonnulls(problem_id, card_id, topic_id, group_id, resource_id) = 1);
CREATE INDEX IF NOT EXISTS tutor_messages_topic_idx ON tutor_messages(topic_id, created_at) WHERE topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tutor_messages_group_idx ON tutor_messages(group_id, created_at) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tutor_messages_resource_idx ON tutor_messages(resource_id, created_at) WHERE resource_id IS NOT NULL;
