CREATE TABLE `product_suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`supplier_id` integer,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`moq` integer DEFAULT 1 NOT NULL,
	`lead_time_days` integer DEFAULT 0 NOT NULL,
	`quoted_on` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_suppliers_product_idx` ON `product_suppliers` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_suppliers_supplier_idx` ON `product_suppliers` (`supplier_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
INSERT INTO `product_suppliers` (`product_id`, `supplier_id`, `price`, `currency`, `moq`, `quoted_on`, `active`, `created_by`, `created_at`)
SELECT `id`, NULL, `price`, `currency`, `moq`, date(`created_at`), 1, `created_by`, `created_at`
FROM `products`;
