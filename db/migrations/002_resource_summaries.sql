ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS model_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS summary_status text NOT NULL DEFAULT 'not_generated'
    CHECK (summary_status IN ('not_generated', 'pending', 'complete', 'failed')),
  ADD COLUMN IF NOT EXISTS summary_provider text,
  ADD COLUMN IF NOT EXISTS summary_model text;
