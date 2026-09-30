-- A tutor reply in any chat may carry one figure, stored like problem and card diagrams.
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS diagram jsonb;
