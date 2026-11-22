CREATE TABLE `aircraft_trails` (
	`icao` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trail_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`samples` integer DEFAULT 0 NOT NULL
);
