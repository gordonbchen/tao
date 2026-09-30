-- Problems now leave figures to the model, and card generation asks per request, so the subject switch is gone.
ALTER TABLE subjects DROP COLUMN IF EXISTS diagrams;
