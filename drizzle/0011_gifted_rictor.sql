CREATE TABLE `bank_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`account_number` text DEFAULT '' NOT NULL,
	`swift` text DEFAULT '' NOT NULL,
	`bank_address` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `bank_account_id` integer REFERENCES bank_accounts(id) ON DELETE SET NULL;--> statement-breakpoint
INSERT INTO `bank_accounts` (`label`, `bank_name`, `account_name`, `account_number`, `swift`, `bank_address`, `is_default`)
SELECT
	CASE WHEN `bank_name` != '' THEN `bank_name` ELSE 'Bank account' END,
	`bank_name`, `bank_account_name`, `bank_account_number`, `bank_swift`, `bank_address`, 1
FROM `company_profile`
WHERE `id` = 1
	AND (`bank_name` != '' OR `bank_account_name` != '' OR `bank_account_number` != '');