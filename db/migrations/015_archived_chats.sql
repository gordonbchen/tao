-- Starting a new study chat keeps the old one: its messages get the time it was set aside.
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
