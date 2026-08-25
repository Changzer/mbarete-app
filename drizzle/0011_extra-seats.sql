-- Seats sold on top of the plan's own cap, granted by hand from the platform
-- panel while billing stays manual. Its own migration (not folded into 0010)
-- because 0010 shipped without it: installs that already applied 0010 would
-- silently skip an amendment and never get the column.
ALTER TABLE "companies" ADD COLUMN "extra_seats" integer DEFAULT 0 NOT NULL;
