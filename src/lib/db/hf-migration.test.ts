import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";

test("fresh database migrates and stores all three HF types with identical owner/name", () => {
  const sqlite = new Database(":memory:");
  try {
    for (const migration of readMigrationFiles({ migrationsFolder: "./drizzle" })) {
      sqlite.transaction(() => { for (const statement of migration.sql) sqlite.exec(statement); })();
    }
    const columns = sqlite.query("PRAGMA table_info(configs)").all() as { name: string }[];
    expect(columns.some(c => c.name === "source_config")).toBe(true);
    expect(columns.some(c => c.name === "github_config")).toBe(false);
    sqlite.run("INSERT INTO users (id, username, email) VALUES ('u', 'alice', 'alice@example.test')");
    sqlite.run("INSERT INTO configs (id,user_id,name,source_config,gitea_config,schedule_config,cleanup_config) VALUES ('c','u','HF','{}','{}','{}','{}')");
    sqlite.run("INSERT INTO sources (id,user_id,name,provider,url,username) VALUES ('s','u','HF','huggingface','https://huggingface.co','alice')");
    for (const type of ["model", "dataset", "space"]) {
      sqlite.prepare("INSERT INTO repositories (id,user_id,config_id,source_id,name,full_name,normalized_full_name,url,clone_url,owner,default_branch,repo_type,source_provider) VALUES (?, 'u','c','s','same','alice/same',?,'https://huggingface.co/alice/same','https://huggingface.co/alice/same.git','alice','main',?,'huggingface')")
        .run(type, `${type}:alice/same`, type);
    }
    expect((sqlite.query("SELECT count(*) AS n FROM repositories").get() as { n: number }).n).toBe(3);
    expect(() => sqlite.run("INSERT INTO repositories SELECT * FROM repositories WHERE id='model'")).toThrow();
  } finally { sqlite.close(); }
});
