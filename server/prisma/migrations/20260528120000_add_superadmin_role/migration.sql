-- Add SUPERADMIN role for the hidden owner-only account
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERADMIN';
