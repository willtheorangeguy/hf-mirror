ALTER TABLE repositories ADD COLUMN repo_type text NOT NULL DEFAULT 'model';
--> statement-breakpoint
ALTER TABLE repositories ADD COLUMN is_gated integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP INDEX IF EXISTS uniq_repositories_user_full_name;
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_repositories_user_full_name ON repositories(user_id, source_id, repo_type, full_name);
--> statement-breakpoint
ALTER TABLE configs RENAME COLUMN github_config TO source_config;
