-- Add INWARD_QC role: an inward-only QC operator that can perform the
-- inward-material QC review (take/finish review) on the Material Inward register
-- and nothing else. Full QC role is unchanged. ADD VALUE preserves existing data.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'INWARD_QC';
