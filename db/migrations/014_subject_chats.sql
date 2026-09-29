-- A chat about a whole subject: progress, weak areas, and what to study next.
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE;
ALTER TABLE tutor_messages DROP CONSTRAINT IF EXISTS tutor_messages_one_parent;
ALTER TABLE tutor_messages ADD CONSTRAINT tutor_messages_one_parent CHECK (num_nonnulls(problem_id, card_id, topic_id, group_id, resource_id, subject_id) = 1);
CREATE INDEX IF NOT EXISTS tutor_messages_subject_idx ON tutor_messages(subject_id, created_at) WHERE subject_id IS NOT NULL;
