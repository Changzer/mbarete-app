CREATE TABLE `exchange_rate_history` (
	`day` text NOT NULL,
	`currency_code` text NOT NULL,
	`rate_to_usd` real NOT NULL,
	`source` text DEFAULT 'auto' NOT NULL,
	PRIMARY KEY(`day`, `currency_code`)
);
--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_expenses` ADD `rates_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_payments` ADD `rates_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_payments` ADD `account` text DEFAULT '' NOT NULL;