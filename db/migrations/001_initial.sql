CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subjects_owner_idx ON subjects(owner_id, created_at);

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  coverage_confirmed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, name)
);
CREATE INDEX IF NOT EXISTS topics_subject_idx ON topics(subject_id, created_at);

CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  extracted_text text NOT NULL DEFAULT '',
  extraction_status text NOT NULL DEFAULT 'complete' CHECK (extraction_status IN ('complete', 'empty', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resources_subject_idx ON resources(subject_id, created_at);

CREATE TABLE IF NOT EXISTS topic_reviews (
  topic_id uuid PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL DEFAULT now(),
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  repetitions integer NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  last_rating text CHECK (last_rating IN ('easy', 'okay', 'hard', 'could_not_solve')),
  last_correctness text CHECK (last_correctness IN ('correct', 'partial', 'incorrect', 'uncertain')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  prompt text NOT NULL,
  solution text NOT NULL,
  hints jsonb NOT NULL DEFAULT '[]'::jsonb,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'okay', 'hard')),
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS problems_subject_idx ON problems(subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('easy', 'okay', 'hard', 'could_not_solve')),
  correctness text NOT NULL CHECK (correctness IN ('correct', 'partial', 'incorrect', 'uncertain')),
  feedback text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_problem_idx ON attempts(problem_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'tutor')),
  kind text NOT NULL CHECK (kind IN ('hint', 'question', 'answer_check')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
