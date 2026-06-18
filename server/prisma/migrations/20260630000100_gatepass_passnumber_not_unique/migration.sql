-- Gate pass numbers are now entered manually by the stores person (no auto-count)
-- and may be duplicated, so drop the unique index on passNumber. fimNumber keeps
-- its own auto-count + unique index.
DROP INDEX IF EXISTS "GatePass_passNumber_key";
