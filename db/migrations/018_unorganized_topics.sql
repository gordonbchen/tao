-- Topics waiting outside the folder tree, such as ones added from a resource's suggestions, until the student or
-- Organize places them. They have no folder.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS unorganized boolean NOT NULL DEFAULT false;
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_unorganized_no_folder;
ALTER TABLE topics ADD CONSTRAINT topics_unorganized_no_folder CHECK (NOT unorganized OR group_id IS NULL);
