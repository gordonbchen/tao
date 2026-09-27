ALTER TABLE problem_feedback ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;
