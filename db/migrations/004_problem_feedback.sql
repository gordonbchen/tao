CREATE TABLE IF NOT EXISTS problem_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL UNIQUE REFERENCES problems(id) ON DELETE CASCADE,
  skipped boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tags <@ ARRAY['too_easy', 'repetitive', 'incorrect', 'outside_coverage', 'other']::text[])
);
