ALTER TABLE `products` ADD `dimension_source` text DEFAULT 'carton' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `piece_length_cm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `piece_width_cm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `piece_height_cm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `piece_weight_kg` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `packing_allowance_pct` real DEFAULT 15 NOT NULL;