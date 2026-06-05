-- Add jobWorkDate column for LOCAL_JOB gate passes (Job Work / RAPS PO order date)
ALTER TABLE "GatePass" ADD COLUMN "jobWorkDate" TIMESTAMP(3);
