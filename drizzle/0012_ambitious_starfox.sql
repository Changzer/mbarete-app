ALTER TABLE `order_expenses` ADD `receipt_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_expenses` ADD `receipt_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_payments` ADD `receipt_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_payments` ADD `receipt_name` text DEFAULT '' NOT NULL;