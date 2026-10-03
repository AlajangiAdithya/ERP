-- Add IN_PROCESS_QC role: an in-process QC operator with exactly the same
-- capabilities as INWARD_QC (material-inward review on the register, its own PRs
-- gated behind QC) - a separate role only so the inspection trail shows which QC
-- function did the review. ADD VALUE preserves existing data.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'IN_PROCESS_QC';
