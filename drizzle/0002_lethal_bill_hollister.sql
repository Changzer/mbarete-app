CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`path` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`);--> statement-breakpoint
-- Carry existing single images into the new table BEFORE the column is
-- dropped, so products photographed under the old schema keep their image.
INSERT INTO `product_images` (`product_id`, `path`, `sort_order`)
SELECT `id`, `image_path`, 0 FROM `products`
WHERE `image_path` IS NOT NULL AND `image_path` != '';--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `image_path`;