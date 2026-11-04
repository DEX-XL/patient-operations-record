CREATE TABLE `audit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`proposal_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`previous_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`actual_microusd` integer,
	`state` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`synthetic_label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`body` text NOT NULL,
	`accepted_by` text,
	`accepted_version` integer,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposals_encounter_idx` ON `proposals` (`encounter_id`);