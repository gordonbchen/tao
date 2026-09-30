-- A study chat's name is a 'title' row beside its messages, so it is archived with them.
ALTER TABLE tutor_messages DROP CONSTRAINT IF EXISTS tutor_messages_kind_check;
ALTER TABLE tutor_messages ADD CONSTRAINT tutor_messages_kind_check CHECK (kind IN ('hint', 'question', 'answer_check', 'summary', 'title'));
