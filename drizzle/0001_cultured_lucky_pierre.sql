CREATE TABLE `replay_events` (
	`id` text PRIMARY KEY NOT NULL,
	`epoch` integer NOT NULL,
	`encounter_id` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replay_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`epoch` integer NOT NULL,
	`clock` text NOT NULL
);
