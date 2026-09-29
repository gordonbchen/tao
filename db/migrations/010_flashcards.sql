-- Flashcards with FSRS scheduling state. A card belongs to a subject and optionally one topic;
-- deleting its topic keeps the card at the subject level instead of losing the student's work.
CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  front text NOT NULL CHECK (length(trim(front)) BETWEEN 1 AND 4000),
  back text NOT NULL CHECK (length(back) <= 8000),
  source text NOT NULL CHECK (source IN ('manual', 'import', 'ai')),
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ts-fsrs Card fields. state: 0 new, 1 learning, 2 review, 3 relearning.
  due timestamptz NOT NULL DEFAULT now(),
  stability double precision NOT NULL DEFAULT 0,
  difficulty double precision NOT NULL DEFAULT 0,
  elapsed_days integer NOT NULL DEFAULT 0,
  scheduled_days integer NOT NULL DEFAULT 0,
  learning_steps integer NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  state smallint NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  last_review timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cards_subject_due_idx ON cards(subject_id, due);
CREATE INDEX IF NOT EXISTS cards_topic_idx ON cards(topic_id);

-- Every review with the scheduler's log, so the algorithm or its parameters can be changed later.
CREATE TABLE IF NOT EXISTS card_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  log jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_reviews_card_idx ON card_reviews(card_id, reviewed_at);

-- The tutor chat serves both problems and cards.
ALTER TABLE tutor_messages ALTER COLUMN problem_id DROP NOT NULL;
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES cards(id) ON DELETE CASCADE;
ALTER TABLE tutor_messages ADD CONSTRAINT tutor_messages_one_parent CHECK ((problem_id IS NULL) <> (card_id IS NULL));
CREATE INDEX IF NOT EXISTS tutor_messages_card_idx ON tutor_messages(card_id, created_at);
