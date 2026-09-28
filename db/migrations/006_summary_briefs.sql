-- One- or two-sentence descriptions generated with each summary, used to rank link suggestions cheaply.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS brief text NOT NULL DEFAULT '';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS brief text NOT NULL DEFAULT '';
