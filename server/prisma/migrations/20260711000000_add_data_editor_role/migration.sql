-- Add DATA_EDITOR role: an edit-only data corrector for non-technical staff.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DATA_EDITOR';
