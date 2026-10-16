import { afterEach, expect, test } from "bun:test";
import { GiteaPushTarget } from "./gitea";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const target = new GiteaPushTarget({ url: "https://forge.example", username: "me", token: "target_secret" });
const marker = `[HF-mirror:${"a".repeat(64)}]`;
function respond(repo: unknown) { globalThis.fetch = (async () => new Response(JSON.stringify(repo), { status: 200 })) as typeof fetch; }
test("does not overwrite an unrelated destination", async () => {
  respond({ name: "same", owner: { login: "me" }, private: true, description: "Unrelated" });
  await expect(target.ensureRepository({ owner: "me", name: "same", isPrivate: true, description: marker })).rejects.toThrow("collision");
});
test("does not push gated or private content into a public destination", async () => {
  respond({ name: "same", owner: { login: "me" }, private: false, description: marker });
  await expect(target.ensureRepository({ owner: "me", name: "same", isPrivate: true, description: marker })).rejects.toThrow("public destination");
});
test("uses the configured origin instead of an API-provided clone URL", async () => {
  respond({ name: "same", owner: { login: "me" }, private: true, description: marker, clone_url: "https://attacker.example/leak.git" });
  const repo = await target.ensureRepository({ owner: "me", name: "same", isPrivate: true, description: marker });
  expect(repo.pushUrl).toBe("https://forge.example/me/same.git");
});
test("does not loop forever when repository creation is rejected", async () => {
  let creates = 0;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { creates++; return Response.json({ message: "Invalid name" }, { status: 422 }); }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  await expect(target.ensureRepository({ owner: "me", name: "invalid", isPrivate: true, description: marker })).rejects.toThrow("422");
  expect(creates).toBe(1);
});
