-- Company lifecycle: the operator's front door and brake in one column.
-- 'pending'  — signed up through a referral link, waiting for approval;
--              the app shows only the waiting screen.
-- 'active'   — normal service.
-- 'suspended'— frozen by the operator; the app shows only the suspended
--              screen, which keeps the data-export door open.
ALTER TABLE "companies" ADD COLUMN "status" text NOT NULL DEFAULT 'active';
