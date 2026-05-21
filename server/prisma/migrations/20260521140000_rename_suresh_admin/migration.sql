-- Rename legacy admin account: username 'suresh' → 'sureshbabu'.
-- Only renames if a row with username='suresh' still exists AND 'sureshbabu' is not already taken.
-- Also normalises the display name so reports / approval matchers see 'Sureshbabu'.
UPDATE "User"
SET "username" = 'sureshbabu',
    "name" = CASE
      WHEN lower("name") = 'suresh' THEN 'Sureshbabu'
      ELSE "name"
    END
WHERE "username" = 'suresh'
  AND NOT EXISTS (
    SELECT 1 FROM "User" u2 WHERE u2."username" = 'sureshbabu'
  );
