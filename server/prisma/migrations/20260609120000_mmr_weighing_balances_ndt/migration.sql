-- Extend MmrSubCategory enum with two new buckets the metrology team
-- now tracks separately: weighing balances and NDT equipment.

ALTER TYPE "MmrSubCategory" ADD VALUE IF NOT EXISTS 'WEIGHING_BALANCES';
ALTER TYPE "MmrSubCategory" ADD VALUE IF NOT EXISTS 'NDT';
