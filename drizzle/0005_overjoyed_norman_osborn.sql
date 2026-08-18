ALTER TABLE `orders` ADD `updated_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `products` ADD `created_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `products` ADD `updated_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `users` ADD `active` integer DEFAULT true NOT NULL;