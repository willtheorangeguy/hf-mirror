import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveHFMetadata } from "./hf-metadata";
import { repositorySchema, sourceConfigSchema, giteaConfigSchema } from "./db/schema";
import { encrypt } from "./utils/encryption";
import { resolveMirrorOptions } from "./utils/mirror-overrides";
import type { SourceRecord } from "./sources";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.ENCRYPTION_SECRET;
let directory: string;
afterEach(() => { globalThis.fetch = originalFetch; if (originalSecret === undefined) delete process.env.ENCRYPTION_SECRET; else process.env.ENCRYPTION_SECRET = originalSecret; });
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("conversation sync is idempotent, applies comment edits, and archives original HF events", async () => {
  process.env.ENCRYPTION_SECRET = originalSecret || "hf-metadata-test-local-secret";
  directory = await mkdtemp(path.join(os.tmpdir(), "hf-metadata-test-"));
  const repository = repositorySchema.parse({ id: "repo", userId: "user", configId: "config", name: "same", fullName: "alice/same", normalizedFullName: "model:alice/same", owner: "alice",
    sourceProvider: "huggingface", sourceUrl: "https://huggingface.co", sourceId: "source", repoType: "model",
    url: "https://huggingface.co/alice/same", cloneUrl: "https://huggingface.co/alice/same.git", defaultBranch: "main", importedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
  const config = { userId: "user", sourceConfig: sourceConfigSchema.parse({ owner: "alice", type: "personal", token: "" }),
    giteaConfig: giteaConfigSchema.parse({ url: "https://forge.example", token: "target_secret", defaultOwner: "me", mirrorIssues: true, mirrorPullRequests: true, mirrorMetadata: true }) };
  const source: SourceRecord = { id: "source", userId: "user", name: "HF", provider: "huggingface", url: "https://huggingface.co", username: "alice", token: null, enabled: true, createdAt: new Date(), updatedAt: new Date() };
  const issues: any[] = []; const comments: any[] = [];
  let commentText = "Original comment";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let result: unknown;
    if (url.hostname === "huggingface.co") {
      if (url.pathname.endsWith("/discussions/1")) result = { num: 1, title: "A contribution", status: "merged", isPullRequest: true, author: { name: "bob" }, createdAt: "2026-01-01T00:00:00Z", events: [
        { id: "event-1", type: "comment", createdAt: "2026-01-01T01:00:00Z", author: { name: "bob" }, data: { latest: { raw: commentText } } },
      ] };
      else if (url.pathname.endsWith("/discussions")) result = { count: 1, start: 0, discussions: [{ num: 1, isPullRequest: true }] };
      else result = { id: "alice/same" };
    } else {
      expect((init?.headers as Record<string, string>).Authorization).toBe("token target_secret");
      if (url.pathname.endsWith("/issues") && method === "GET") result = issues;
      else if (url.pathname.endsWith("/issues") && method === "POST") { const issue = { ...body, number: 1, state: "open" }; issues.push(issue); result = issue; }
      else if (url.pathname.endsWith("/issues/1") && method === "PATCH") { Object.assign(issues[0], body); result = issues[0]; }
      else if (url.pathname.endsWith("/comments") && method === "GET") result = comments;
      else if (url.pathname.endsWith("/comments") && method === "POST") { const comment = { ...body, id: 10 }; comments.push(comment); result = comment; }
      else if (url.pathname.endsWith("/comments/10") && method === "PATCH") { Object.assign(comments[0], body); result = comments[0]; }
      else throw new Error(`Unexpected fixture request ${method} ${url}`);
    }
    return Response.json(result);
  }) as typeof fetch;
  const input = { config, repository, sources: [source], owner: "me", name: "model--alice--same", archiveDirectory: directory, options: resolveMirrorOptions({ config, repository }) };
  await archiveHFMetadata(input);
  commentText = "Edited comment";
  await archiveHFMetadata(input);
  expect(issues.length).toBe(1); expect(comments.length).toBe(1);
  expect(issues[0].state).toBe("closed"); expect(comments[0].body).toContain("Edited comment");
  expect(comments[0].body).toContain("bob");
  const archive = await Bun.file(path.join(directory, "latest.json")).json();
  expect(archive.discussions[0].events[0].data.latest.raw).toBe("Edited comment");
});
