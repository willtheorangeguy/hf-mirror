import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";
import { clonePathForRepository } from "@/lib/push-engine/paths";

// Module mocks are process-wide in Bun; keep the real database isolated.
const CHILD_FLAG = "HF_REPOSITORIES_DELETE_ISOLATED";
const isChild = !!process.env[CHILD_FLAG];

if (!isChild) {
  test("repository deletion - isolated child suite", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", import.meta.path],
      env: { ...process.env, [CHILD_FLAG]: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      console.error(result.stdout.toString());
      console.error(result.stderr.toString());
    }
    expect(result.exitCode).toBe(0);
  }, 60_000);
}

describe.skipIf(!isChild)("DELETE /api/repositories clone cleanup", () => {
  const sqlite = new Database(":memory:");
  const db = drizzle({ client: sqlite });
  let root = "";
  const previousCloneDir = process.env.MIRROR_CLONE_DIR;
  let DELETE: any;

  const repository = {
    owner: "alice",
    name: "shared-name",
    sourceProvider: "huggingface",
    sourceUrl: "https://huggingface.co",
    sourceId: "connection-a",
    repoType: "dataset",
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-delete-clones-"));
    process.env.MIRROR_CLONE_DIR = root;
    const folder = join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries) {
      for (const statement of readFileSync(join(folder, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.run(statement);
      }
    }
    sqlite.run("PRAGMA foreign_keys = OFF");
    mock.module("@/lib/db", () => ({ ...schema, db }));
    mock.module("@/lib/utils/auth-helpers", () => ({
      requireAuth: async () => ({ user: { id: "user-1" }, response: null }),
    }));
    ({ DELETE } = await import("@/pages/api/repositories/index"));
  });

  afterAll(() => {
    sqlite.close();
    if (previousCloneDir === undefined) delete process.env.MIRROR_CLONE_DIR;
    else process.env.MIRROR_CLONE_DIR = previousCloneDir;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("removes the full source/type clone and preserves unrelated clones and rows", async () => {
    const variants = [
      repository,
      { ...repository, repoType: "model" },
      { ...repository, sourceId: "connection-b" },
    ];
    for (const variant of variants) {
      const location = clonePathForRepository(variant);
      mkdirSync(location, { recursive: true });
      writeFileSync(join(location, "HEAD"), "ref: refs/heads/main\n");
    }
    for (const [id, userId] of [["selected", "user-1"], ["other-user", "user-2"]]) {
      sqlite.run(`INSERT INTO repositories (
        id, user_id, config_id, name, full_name, normalized_full_name, owner, url, clone_url,
        source_provider, source_url, source_id, repo_type, destination_provider,
        default_branch, imported_at, created_at, updated_at
      ) VALUES (?, ?, 'config-1', 'shared-name', 'alice/shared-name', 'alice/shared-name', 'alice',
        'https://huggingface.co/datasets/alice/shared-name',
        'https://huggingface.co/datasets/alice/shared-name.git',
        'huggingface', 'https://huggingface.co', 'connection-a', 'dataset', 'gitea',
        'main', 1, 1, 1)`, [id, userId]);
    }

    const response = await DELETE({
      request: new Request("http://localhost/api/repositories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["selected", "other-user"] }),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deleted: 1 });
    expect(existsSync(clonePathForRepository(repository))).toBe(false);
    for (const variant of variants.slice(1)) {
      expect(existsSync(join(clonePathForRepository(variant), "HEAD"))).toBe(true);
    }
    expect(sqlite.query("SELECT id FROM repositories ORDER BY id").all()).toEqual([{ id: "other-user" }]);
  });
});
