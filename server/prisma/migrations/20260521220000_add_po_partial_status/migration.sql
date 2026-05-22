-- Add PARTIAL status to PurchaseOrderStatus enum (used when partial inward done; PO stays open for remaining qty).
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
