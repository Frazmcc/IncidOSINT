CREATE TABLE `feed_state` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`fetched_at` integer DEFAULT 0 NOT NULL,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`window_start` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
