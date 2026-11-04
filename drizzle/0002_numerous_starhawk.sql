CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`state` text NOT NULL,
	`actions` text NOT NULL,
	`proposal_id` text,
	`error_code` text,
	`prompt_hash` text,
	`created_at` integer NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `funding_records` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence` text NOT NULL
);
