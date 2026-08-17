ALTER TABLE `orders` ADD `secondary_currency` text DEFAULT 'CNY' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `commission_pct` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `rates_snapshot` text DEFAULT '{}' NOT NULL;