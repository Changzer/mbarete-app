ALTER TABLE "followup_cards" ADD COLUMN "next_assigned_by" integer;--> statement-breakpoint
ALTER TABLE "followup_cards" ADD COLUMN "next_assigned_at" text;--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ADD COLUMN "assigned_by" integer;--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ADD COLUMN "assigned_at" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tasks_seen_at" text;
