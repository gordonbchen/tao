-- Optional generated diagrams ({kind, source, alt}) on problems and cards, and a per-subject switch for generating them.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS diagrams boolean NOT NULL DEFAULT false;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS diagram jsonb, ADD COLUMN IF NOT EXISTS solution_diagram jsonb;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS front_diagram jsonb, ADD COLUMN IF NOT EXISTS back_diagram jsonb;
