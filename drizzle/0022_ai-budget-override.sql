-- Per-company override of the plan's daily AI read allowance, set from the
-- platform panel. NULL follows the plan; 0 switches AI reading off for the
-- company; any other number is a custom cap.
ALTER TABLE "companies" ADD COLUMN "ai_reads_per_day" integer;
