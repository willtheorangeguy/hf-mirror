import { afterEach, describe, expect, test } from "bun:test";
import { HuggingFaceSourceProvider, mapHFRepository, resolveHFRepositoryPath } from "./huggingface";
import { normalizedRepositoryName, mergeGitReposPreferStarred } from "@/lib/repo-utils";
import type { SourceConnection } from "./types";
import { SourceApiError } from "./http";

const connection: SourceConnection = { provider: "huggingface", url: "https://huggingface.co", username: "alice", token: "hf_secret" };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
function install(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(url), init))) as typeof fetch;
}

describe("HF identity and URLs", () => {
  test("recognizes models, datasets, Spaces, clone URLs and file deep links", () => {
    expect(resolveHFRepositoryPath(["alice", "model.git"])?.repoType).toBe("model");
    expect(resolveHFRepositoryPath(["datasets", "alice", "same", "tree", "main"])).toEqual({ owner: "alice", repo: "same", repoType: "dataset" });
    expect(resolveHFRepositoryPath(["spaces", "alice", "same"])?.repoType).toBe("space");
    expect(resolveHFRepositoryPath(["datasets", "alice"])).toBeNull();
    expect(resolveHFRepositoryPath(["..", "repo"])).toBeNull();
  });
  test("keeps same-name repositories distinct by type", () => {
    const repos = (["model", "dataset", "space"] as const).map(type => mapHFRepository({ id: "alice/same" }, type, connection));
    expect(mergeGitReposPreferStarred(repos, []).length).toBe(3);
    expect(new Set(repos.map(r => normalizedRepositoryName(r.fullName, r.repoType, r.sourceProvider))).size).toBe(3);
    expect(repos[1].cloneUrl).toBe("https://huggingface.co/datasets/alice/same.git");
  });
  test("preserves gating separately from public visibility", () => {
    const repo = mapHFRepository({ id: "alice/gated", gated: "manual" }, "model", connection);
    expect(repo.isGated).toBe(true);
    expect(repo.isPrivate).toBe(false);
    expect(mapHFRepository({ id: "alice/open", gated: false }, "dataset", connection).isGated).toBe(false);
  });
});

describe("HF API adapter", () => {
  test("authenticates with bearer token and follows pagination", async () => {
    let calls = 0;
    install((url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer hf_secret");
      calls++;
      return url.endsWith("page=2") ? json([2]) : json([1], 200, { link: '<https://huggingface.co/api/models?page=2>; rel="next"' });
    });
    expect(await new HuggingFaceSourceProvider(connection).paginate("/api/models")).toEqual([1, 2]);
    expect(calls).toBe(2);
  });
  test("refuses cross-origin pagination before sending credentials", async () => {
    let calls = 0;
    install(() => { calls++; return json([], 200, { link: '<https://other.example/api/models>; rel="next"' }); });
    await expect(new HuggingFaceSourceProvider(connection).paginate("/api/models")).rejects.toThrow("crossed source origin");
    expect(calls).toBe(1);
  });
  test("fails repeated pagination rather than returning a partial discovery", async () => {
    install(() => json([], 200, { link: '</api/models>; rel="next"' }));
    await expect(new HuggingFaceSourceProvider(connection).paginate("/api/models")).rejects.toThrow("incomplete");
  });
  test("404 is not interpreted as repository deletion", async () => {
    install(() => json({ error: "not found" }, 404));
    await expect(new HuggingFaceSourceProvider(connection).getRepository("alice", "private")).rejects.toBeInstanceOf(SourceApiError);
  });
  test("public access does not send an authorization header", async () => {
    install((_url, init) => { expect((init?.headers as Record<string, string>).Authorization).toBeUndefined(); return json([]); });
    expect(await new HuggingFaceSourceProvider({ ...connection, token: "" }).paginate("/api/models")).toEqual([]);
  });
  test("retries transient rate limits", async () => {
    let calls = 0;
    install(() => ++calls === 1 ? json({}, 429, { "retry-after": "1" }) : json({ name: "alice" }));
    expect((await new HuggingFaceSourceProvider(connection).testConnection()).login).toBe("alice");
    expect(calls).toBe(2);
  });
});
