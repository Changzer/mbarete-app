ALTER TABLE `users` ADD `role` text DEFAULT 'collaborator' NOT NULL;--> statement-breakpoint
UPDATE `users` SET `role` = 'admin';
