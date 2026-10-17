import { afterEach, expect, test } from "bun:test";
import { GiteaPushTarget } from "./gitea";
import { createPushTargetFromConfig } from "@/lib/destination-connection";
import { giteaConfigSchema } from "@/lib/db/schema";
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

test("creates HF repositories in an existing organization", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(String(url)).pathname;
    requests.push(`${init?.method ?? "GET"} ${route}`);
    if (route === "/api/v1/orgs/hf-backups") return Response.json({ username: "hf-backups" });
    if (init?.method === "POST" && route === "/api/v1/orgs/hf-backups/repos") {
      const body = JSON.parse(String(init.body));
      expect(body.private).toBe(true);
      expect(body.description).toBe(marker);
      return Response.json({ ...body, owner: { login: "hf-backups" }, html_url: "https://forge.example/hf-backups/model" });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  const repo = await target.ensureRepository({ owner: "hf-backups", name: "model", isPrivate: true, description: marker });
  expect(repo.owner).toBe("hf-backups");
  expect(repo.pushUrl).toBe("https://forge.example/hf-backups/model.git");
  expect(requests).toEqual([
    "GET /api/v1/repos/hf-backups/model", "GET /api/v1/orgs/hf-backups", "POST /api/v1/orgs/hf-backups/repos",
  ]);
});

test("surfaces denied organization permissions without falling back to a personal repository", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(String(url)).pathname;
    requests.push(route);
    if (route === "/api/v1/orgs/hf-backups") return Response.json({ username: "hf-backups" });
    return Response.json({}, { status: init?.method === "POST" ? 403 : 404 });
  }) as typeof fetch;
  await expect(target.ensureRepository({ owner: "hf-backups", name: "model", isPrivate: true, description: marker })).rejects.toThrow("403");
  expect(requests).not.toContain("/api/v1/user/repos");
});

test("creates a missing organization before its HF repository", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(String(url)).pathname;
    requests.push(`${init?.method ?? "GET"} ${route}`);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (route === "/api/v1/orgs") {
        expect(body).toEqual({ username: "hf-backups", visibility: "private" });
        return Response.json(body);
      }
      return Response.json({ ...body, owner: { login: "hf-backups" } });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  await target.ensureRepository({ owner: "hf-backups", name: "model", isPrivate: true, description: marker });
  expect(requests).toEqual([
    "GET /api/v1/repos/hf-backups/model", "GET /api/v1/orgs/hf-backups",
    "POST /api/v1/orgs", "POST /api/v1/orgs/hf-backups/repos",
  ]);
});

for (const visibility of ["public", "limited", "private", "default"] as const) {
  test(`creates organizations with configured ${visibility} visibility`, async () => {
    let organizationCreated = false;
    const configuredTarget = createPushTargetFromConfig({
      giteaConfig: giteaConfigSchema.parse({ url: "https://forge.example", defaultOwner: "me", token: "target_secret", visibility }),
    });
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const route = new URL(String(url)).pathname;
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (route === "/api/v1/orgs") {
          expect(body).toEqual({ username: "hf-backups", ...(visibility === "default" ? {} : { visibility }) });
          organizationCreated = true;
          return Response.json(body);
        }
        return Response.json({ ...body, owner: { login: "hf-backups" } });
      }
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
    await configuredTarget.ensureRepository({ owner: "hf-backups", name: "model", isPrivate: true, description: marker });
    expect(organizationCreated).toBe(true);
  });
}
