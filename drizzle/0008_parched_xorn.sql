ALTER TABLE `order_items` ADD `sell_price_snapshot` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `sell_price` real DEFAULT 0 NOT NULL;