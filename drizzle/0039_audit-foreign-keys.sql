-- Usage and audit rows must name real companies, and any users they credit
-- must belong to that company. The admin actor already has this protection
-- from 0023; these constraints complete the remaining relationships.
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_company_target_fk" FOREIGN KEY ("company_id","target_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
