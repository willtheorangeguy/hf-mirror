import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";

// Keep real auth and the in-memory adapter isolated from other suites' mocks.
const childFlag = "HF_OIDC_LOGIN_ISOLATED";
const isChild = process.env[childFlag] === "1";
if (!isChild) {
  test("OIDC login - isolated integration suite", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", "--timeout", "30000", import.meta.path],
      env: { ...process.env, [childFlag]: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    if (result.exitCode !== 0) console.error(result.stdout.toString(), result.stderr.toString());
    expect(result.exitCode).toBe(0);
  }, 60_000);
}

describe.skipIf(!isChild)("OIDC login with the production auth configuration", () => {
  let sqlite: Database;
  let provider: ReturnType<typeof Bun.serve>;
  let auth: typeof import("@/lib/auth").auth;
  let routes: typeof import("@/pages/api/sso/providers");
  let adminId: string;
  let issuer: string;
  let email = "admin@example.test";
  let invalidAudience = false;
  let tokenRequests = 0;
  const app = "http://localhost:5321";
  const clientId = "oidc-integration-client";
  const clientSecret = "oidc-integration-secret";
  const codes = new Map<string, { challenge: string; redirectURI: string }>();
  const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

  beforeAll(async () => {
    // The shared test preload replaces timers; network tests need real timers.
    globalThis.setTimeout = (globalThis as any).__originalSetTimeout ?? globalThis.setTimeout;
    process.env.BETTER_AUTH_SECRET = "oidc-integration-only-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = app;
    process.env.BASE_URL = "/";
    delete process.env.AUTH_ALLOW_SIGNUP;
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    sqlite = new Database(":memory:");
    const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    for (const entry of journal.entries) {
      for (const statement of readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.run(statement);
      }
    }
    const db = drizzle({ client: sqlite, schema });
    mock.module("@/lib/db", () => ({ ...schema, db }));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "integration-key", alg: "RS256", use: "sig" };
    provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration") return Response.json({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo`,
        scopes_supported: ["openid", "email", "profile"], token_endpoint_auth_methods_supported: ["client_secret_basic"],
      });
      if (url.pathname === "/authorize") {
        expect(url.searchParams.get("client_id")).toBe(clientId);
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        const code = randomUUID();
        const redirectURI = url.searchParams.get("redirect_uri")!;
        codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirectURI });
        const callback = new URL(redirectURI);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        return Response.redirect(callback, 302);
      }
      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (url.pathname === "/userinfo") {
        expect(request.headers.get("authorization")).toBe("Bearer integration-access-token");
        return Response.json({ sub: email, email, name: "OIDC tester", email_verified: false });
      }
      if (url.pathname === "/token") {
        tokenRequests++;
        expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`);
        const body = new URLSearchParams(await request.text());
        const code = codes.get(body.get("code")!);
        expect(code).toBeDefined();
        codes.delete(body.get("code")!);
        expect(body.get("redirect_uri")).toBe(code!.redirectURI);
        expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(code!.challenge);
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
        const claims = Buffer.from(JSON.stringify({ iss: issuer, aud: invalidAudience ? "wrong-client" : clientId,
          sub: email, email, email_verified: false, name: "OIDC tester", iat: now, exp: now + 300 })).toString("base64url");
        const input = `${header}.${claims}`;
        const signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
        return Response.json({ access_token: "integration-access-token", token_type: "Bearer", expires_in: 300, id_token: `${input}.${signature}` });
      }
      return new Response("Not found", { status: 404 });
    } });
    issuer = `http://127.0.0.1:${provider.port}`;
    ({ auth } = await import("@/lib/auth"));
    routes = await import("@/pages/api/sso/providers");
    const signup = await auth.handler(new Request(`${app}/api/auth/sign-up/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app },
      body: JSON.stringify({ name: "Local admin", email, password: "integration-password-12345" }),
    }));
    expect(signup.status).toBe(200);
    adminId = (await signup.json()).user.id;
    const created = await routes.POST({ request: new Request(`${app}/api/sso/providers`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies(signup), Origin: app },
      body: JSON.stringify({ issuer, domain: "example.test", providerId: "local-oidc", clientId, clientSecret }),
    }) } as any);
    expect([created.status, await created.json()]).toEqual([201, expect.anything()]);
  });

  afterAll(() => { provider?.stop(true); sqlite?.close(); });

  async function beginLogin(selection: Record<string, string> = { providerId: "local-oidc" }) {
    const response = await auth.handler(new Request(`${app}/api/auth/sign-in/sso`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app },
      body: JSON.stringify({ ...selection, callbackURL: `${app}/` }),
    }));
    expect(response.status).toBe(200);
    const { url } = await response.json();
    const authorization = await fetch(url, { redirect: "manual" });
    expect(authorization.status).toBe(302);
    return { callback: authorization.headers.get("location")!, cookie: cookies(response) };
  }

  async function finishLogin(selection?: Record<string, string>) {
    const { callback, cookie } = await beginLogin(selection);
    const response = await auth.handler(new Request(callback, { headers: { Cookie: cookie } }));
    expect([response.status, response.headers.get("location")]).toEqual([302, `${app}/`]);
    const sessionResponse = await auth.handler(new Request(`${app}/api/auth/get-session`, { headers: { Cookie: cookies(response) } }));
    return sessionResponse.json();
  }

  test("links a local account by matching provider domain and establishes a cookie session", async () => {
    const session = await finishLogin();
    expect(session.user.id).toBe(adminId);
    expect(session.user.email).toBe(email);
    expect(sqlite.query("SELECT count(*) AS count FROM users").get()).toEqual({ count: 1 });
    expect(tokenRequests).toBe(1);
  });

  test("discovers the provider by email and provisions a new SSO user with email signup closed", async () => {
    email = "new-user@example.test";
    const session = await finishLogin({ email });
    expect(session.user.email).toBe(email);
    expect(session.user.id).not.toBe(adminId);
    expect(session.user.username).toBe("OIDC tester");
  });

  test("rejects a modified OAuth state before exchanging tokens", async () => {
    const { callback, cookie } = await beginLogin();
    const changed = new URL(callback);
    changed.searchParams.set("state", "invalid-state");
    const before = tokenRequests;
    const response = await auth.handler(new Request(changed, { headers: { Cookie: cookie } }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
    expect(tokenRequests).toBe(before);
    expect(cookies(response)).not.toContain("session_token");
  });

  test("rejects an ID token issued for another client", async () => {
    invalidAudience = true;
    try {
      const { callback, cookie } = await beginLogin();
      const response = await auth.handler(new Request(callback, { headers: { Cookie: cookie } }));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("error=");
      expect(cookies(response)).not.toContain("session_token");
    } finally { invalidAudience = false; }
  });
});
