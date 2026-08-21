CREATE TABLE `capture_draft_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` integer NOT NULL,
	`role` text DEFAULT 'image' NOT NULL,
	`path` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `capture_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capture_draft_images_draft_idx` ON `capture_draft_images` (`draft_id`);--> statement-breakpoint
CREATE TABLE `capture_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`user_id` integer,
	`kind` text DEFAULT 'product' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`transcript` text DEFAULT '{}' NOT NULL,
	`transcript_notes` text DEFAULT '' NOT NULL,
	`transcript_error` text DEFAULT '' NOT NULL,
	`product_id` integer,
	`captured_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_drafts_client_id_unique` ON `capture_drafts` (`client_id`);--> statement-breakpoint
CREATE INDEX `capture_drafts_status_idx` ON `capture_drafts` (`status`);