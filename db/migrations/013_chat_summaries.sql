-- A chat can be summarized: the summary stands in for the messages before it when the tutor replies.
ALTER TABLE tutor_messages DROP CONSTRAINT IF EXISTS tutor_messages_kind_check;
ALTER TABLE tutor_messages ADD CONSTRAINT tutor_messages_kind_check CHECK (kind IN ('hint', 'question', 'answer_check', 'summary'));
