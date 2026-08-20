CREATE TABLE `contact_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`path` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_images_contact_idx` ON `contact_images` (`contact_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `company_name_zh` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `booth_location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `bank_info` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `supplier_id` integer REFERENCES contacts(id);--> statement-breakpoint
ALTER TABLE `products` ADD `duplicated_from_id` integer REFERENCES products(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `products_supplier_idx` ON `products` (`supplier_id`);