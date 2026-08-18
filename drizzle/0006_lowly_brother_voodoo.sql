CREATE TABLE `company_profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`company_name` text DEFAULT '' NOT NULL,
	`address_lines` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`bank_account_name` text DEFAULT '' NOT NULL,
	`bank_account_number` text DEFAULT '' NOT NULL,
	`bank_swift` text DEFAULT '' NOT NULL,
	`bank_address` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`incoterms` text DEFAULT '' NOT NULL,
	`validity_days` integer DEFAULT 30 NOT NULL,
	`footer_note` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
