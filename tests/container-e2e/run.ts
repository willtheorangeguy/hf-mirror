import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const project = process.env.E2E_PROJECT ?? `hf-e2e-${Date.now()}`;
if (!/^hf-e2e-[a-z0-9-]+$/.test(project)) throw new Error("E2E_PROJECT must start with hf-e2e- and contain only lowercase letters, numbers and hyphens");
const output = path.join(root, "tests/e2e/test-results/container");
await mkdir(output, { recursive: true });
const compose = ["compose", "--env-file", "tests/container-e2e/test.env", "-p", project, "-f", "tests/container-e2e/compose.yml"];
const app = `http://localhost:${process.env.E2E_APP_PORT ?? 4328}`;
const gitea = `http://localhost:${process.env.E2E_GITEA_PORT ?? 4333}`;
const source = `http://localhost:${process.env.E2E_SOURCE_PORT ?? 4591}`;
const password = "Container-test-password-7531!";
const results: { name: string; durationMs: number; status: string }[] = [];
async function command(args: string[], quiet = false) {
  const p = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`${args.slice(0, 5).join(" ")} failed (${code}): ${stdout}\n${stderr}`);
  if (!quiet) console.log(stdout || stderr);
  return stdout;
}
async function step(name: string, run: () => Promise<void>) {
  console.log(`\n[E2E] ${name}`); const start = Date.now();
  try { await run(); results.push({ name, durationMs: Date.now() - start, status: "passed" }); }
  catch (error) { results.push({ name, durationMs: Date.now() - start, status: "failed" }); throw error; }
}
let cookie = "";
let token = "";
async function api(base: string, route: string, body?: unknown, auth = "") {
  const response = await fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", headers: {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(base === app ? { Origin: app, Cookie: cookie } : auth ? { Authorization: auth } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  assert(response.ok, `${route}: HTTP ${response.status} ${text}`);
  if (base === app) {
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(value => value.split(";")[0]).join("; ");
  }
  return text ? JSON.parse(text) : null;
}
const target = (route: string) => api(gitea, `/api/v1${route}`, undefined, `token ${token}`);
async function branchesReady(route: string): Promise<any[]> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const branches = await target(`${route}/branches`);
    if (Array.isArray(branches) && branches.length) return branches;
    await Bun.sleep(500);
  }
  throw new Error(`Gitea did not index pushed branches: ${JSON.stringify(await target(route))}`);
}
async function rows(): Promise<any[]> { const data = await api(app, "/api/dashboard"); return data.repositories ?? data.repos; }
async function mirror(repo: any, mode = "mirror", expected = "", approve = false) {
  const previous = await api(app, "/api/dashboard");
  const before = previous.repositories.find((row: any) => row.id === repo.id)?.lastMirrored;
  const activities = new Set(previous.activities.map((activity: any) => activity.id));
  await api(app, approve ? "/api/job/approve-sync" : `/api/job/${mode}-repo`, { repositoryIds: [repo.id], ...(approve ? { action: "approve" } : {}) });
  const deadline = Date.now() + 180_000;
  let latest: any;
  let failedSince = 0;
  while (Date.now() < deadline) {
    const dashboard = await api(app, "/api/dashboard");
    latest = dashboard.repositories.find((row: any) => row.id === repo.id);
    // The job retries ordinary failures twice with 2s/4s backoff. Require a
    // stable failure so the next scenario cannot race an outstanding retry.
    if (expected === "failed" && latest.status === "failed") {
      failedSince ||= Date.now();
      if (Date.now() - failedSince >= 12_000) return latest;
    } else {
      failedSince = 0;
      if (expected && latest.status === expected) return latest;
    }
    if (["failed", "pending-approval"].includes(latest.status) && latest.status !== expected) throw new Error(`Mirror ${repo.repoType}: ${latest.status}: ${latest.errorMessage}`);
    const finished = dashboard.activities.some((activity: any) => !activities.has(activity.id) && activity.repositoryId === repo.id && ["mirrored", "synced"].includes(activity.status));
    if (!expected && ["mirrored", "synced"].includes(latest.status) && latest.lastMirrored && (latest.lastMirrored !== before || finished)) return latest;
    await Bun.sleep(500);
  }
  throw new Error(`Mirror timeout: ${JSON.stringify(latest)}`);
}
const repoName = (type = "model") => type === "model" ? "tiny" : `tiny-${type}s`;
const repoRoute = (type = "model") => `/repos/e2e_admin/${repoName(type)}`;
let model: any;
try {
  if (!process.argv.includes("--skip-build")) await step("Build production Docker image", async () => {
    await command(["docker", "build", "-t", "hf-mirror:e2e", "."]);
  });
  await step("Deploy isolated production app, Gitea and HF source containers", async () => {
    await command(["docker", ...compose, "up", "-d", "--wait", "--wait-timeout", "240"]);
    await command(["docker", ...compose, "exec", "-T", "--user", "git", "gitea", "gitea", "admin", "user", "create", "--username", "e2e_admin", "--password", password, "--email", "admin@example.test", "--admin", "--must-change-password=false"], true);
    token = (await api(gitea, "/api/v1/users/e2e_admin/tokens", { name: "container-e2e", scopes: ["all"] }, `Basic ${Buffer.from(`e2e_admin:${password}`).toString("base64")}`)).sha1;
    assert(token);
    assert.equal((await fetch(`${app}/api/config`)).status, 401);
    await api(app, "/api/auth/sign-up/email", { name: "Container tester", email: "container@example.test", password });
    assert(cookie, "Signup must create a session");
    await api(app, "/api/config", {
      sourceConfig: { provider: "huggingface", url: "http://source:8080", username: "alice", token: "fixture-token", privateRepositories: true, mirrorStarred: false, repoTypes: ["model", "dataset", "space"], collections: [] },
      giteaConfig: { provider: "gitea", url: "http://gitea:3000", username: "e2e_admin", token, visibility: "public", mirrorStrategy: "flat-user", backupStrategy: "block-on-force-push", blockSyncOnBackupFailure: true },
      scheduleConfig: { enabled: false, interval: 3600 },
      cleanupConfig: { enabled: false, retentionDays: 86400 },
      mirrorOptions: { mirrorLFS: true, mirrorReleases: false, mirrorMetadata: true, metadataComponents: { issues: true, pullRequests: true, labels: false, milestones: false, wiki: false } },
      advancedOptions: { skipForks: false, starredCodeOnly: false },
    });
  });
  await step("Import and mirror model, gated dataset and private Space using their source names", async () => {
    for (const type of ["model", "dataset", "space"]) {
      const data = await api(app, "/api/sync/repository", { owner: "alice", repo: repoName(type), repoType: type });
      assert.equal(data.success, true); const repo = data.repository;
      if (type === "model") model = repo;
      await mirror(repo);
      const destination = await target(repoRoute(type));
      assert.equal(destination.name, repoName(type));
      assert.equal(destination.private, type !== "model", `${type} privacy`);
      assert.equal(destination.default_branch, "main");
      assert.equal(destination.mirror, false);
      const branches = await branchesReady(repoRoute(type));
      assert(branches.some((b: any) => b.name === "extra"));
      assert((await target(`${repoRoute(type)}/tags`)).some((t: any) => t.name === "v1"));
    }
    assert.equal((await rows()).length, 3);
    const discovery = await api(app, "/api/sync", {});
    assert.equal(discovery.success, true);
    assert.equal((await rows()).length, 3, "Discovery must deduplicate by source and HF type");
  });
  await step("Incremental sync updates tags and metadata without duplicates", async () => {
    const state = await api(source, "/__test/advance", {});
    await mirror(model, "sync");
    const branches = await target(`${repoRoute()}/branches`);
    assert.equal(branches.find((b: any) => b.name === "main").commit.id, state.sha);
    assert(branches.some((b: any) => b.name === "extra"));
    assert((await target(`${repoRoute()}/tags`)).some((t: any) => t.name === "v2"));
    await mirror(model, "sync");
    const issues = await target(`${repoRoute()}/issues?state=all&type=issues`);
    assert.equal(issues.length, 2);
    for (const issue of issues) {
      assert.equal(issue.state, "closed");
      const comments = await target(`${repoRoute()}/issues/${issue.number}/comments`);
      assert.equal(comments.length, 1);
      assert.match(comments[0].body, /Comment revision 2/);
    }
    const archive = await api(app, `/api/repositories/${model.id}/archive`);
    assert.equal(archive.transfer.git, "complete");
    assert.deepEqual([...archive.transfer.objects].sort((a, b) => a.oid.localeCompare(b.oid)),
      [{ oid: state.oid, size: state.size }, { oid: state.prOid, size: state.prSize }].sort((a, b) => a.oid.localeCompare(b.oid)));
    assert(archive.transfer.refs["refs/hf-mirror/pr/7"]);
    assert.equal(archive.metadata.discussions.length, 2);
  });
  await step("History rewrite and branch deletion require approval and a recovery bundle", async () => {
    const before = (await target(`${repoRoute()}/branches/main`)).commit.id;
    const state = await api(source, "/__test/rewrite", {});
    await mirror(model, "sync", "pending-approval");
    assert.equal((await target(`${repoRoute()}/branches/main`)).commit.id, before);
    await mirror(model, "sync", "", true);
    assert.equal((await target(`${repoRoute()}/branches/main`)).commit.id, state.sha);
    assert(!(await target(`${repoRoute()}/branches`)).some((b: any) => b.name === "extra"));
    const bundles = await command(["docker", ...compose, "exec", "-T", "app", "find", "/app/data", "-name", "*.bundle"], true);
    assert.match(bundles, /\.bundle/);
    const savedRefs = await command(["docker", ...compose, "exec", "-T", "app", "find", "/app/data", "-name", "*.bundle", "-exec", "git", "bundle", "list-heads", "{}", ";"], true);
    assert(savedRefs.includes(before), "Recovery bundle must retain the previous destination commit");
  });
  await step("Missing LFS bytes fail safely before destination refs change", async () => {
    const before = (await target(`${repoRoute()}/branches/main`)).commit.id;
    await api(source, "/__test/missing", {});
    await mirror(model, "sync", "failed");
    assert.equal((await target(`${repoRoute()}/branches/main`)).commit.id, before);
  });
  await step("Restore historical LFS weights from Gitea with HF source offline", async () => {
    const expected = await api(source, "/__test/state");
    await api(source, "/__test/offline", {});
    const restored = await api(source, "/__test/restore", { cloneUrl: "http://gitea:3000/e2e_admin/tiny.git", token });
    assert.equal(restored.oid, expected.oid); assert.equal(restored.size, expected.size); assert.equal(restored.denied, 0);
    assert.equal(restored.prOid, expected.prOid);
  });
  await step("Restart production app and retain sessions, configuration and repository records", async () => {
    await command(["docker", ...compose, "restart", "app"], true);
    await command(["docker", ...compose, "up", "-d", "--wait", "--wait-timeout", "180"], true);
    assert.equal((await rows()).length, 3);
    assert.equal((await api(app, "/api/config")).sourceConfig.provider, "huggingface");
  });
  await step("Browser renders authenticated repository UI without runtime errors", async () => {
    const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}), headless: true });
    try {
      const context = await browser.newContext();
      await context.addCookies(cookie.split("; ").map(pair => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1), url: app })));
      const page = await context.newPage(); const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${app}/repositories`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.body.innerText.includes("tiny"), undefined, { timeout: 30_000 });
      assert.match(await page.locator("body").innerText(), /tiny/);
      await page.screenshot({ path: path.join(output, "repositories.png"), fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
  if (process.argv.includes("--live-hf") || process.env.E2E_LIVE_HF === "true") {
    await step("Live Hugging Face model backs up Git and large files to real Gitea", async () => {
      const connection = await api(app, "/api/sources", { name: "Live public Hugging Face", provider: "huggingface", url: "https://huggingface.co", username: "hf-internal-testing", token: "" });
      const imported = await api(app, "/api/sync/repository", { sourceId: connection.source.id, owner: "hf-internal-testing", repo: "tiny-random-BertModel", repoType: "model" });
      await mirror(imported.repository);
      const archive = await api(app, `/api/repositories/${imported.repository.id}/archive`);
      assert.equal(archive.transfer.largeFiles, "complete");
      assert(archive.transfer.objects.length > 0, "Live model must contain large file objects");
      const object = archive.transfer.objects[0];
      const restored = await api(source, "/__test/restore", { cloneUrl: "http://gitea:3000/e2e_admin/tiny-random-BertModel.git", token, expectedOid: object.oid });
      assert.equal(restored.oid, object.oid); assert.equal(restored.size, object.size);
    });
  }
  console.log(`\n${results.length} container E2E checks passed.`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ project, results }, null, 2));
  try { await writeFile(path.join(output, "containers.log"), await command(["docker", ...compose, "logs", "--no-color"], true)); } catch (error) { console.error(error); }
  if (process.argv.includes("--keep")) console.log(`Keeping test stack. Cleanup: docker ${compose.join(" ")} down --volumes --remove-orphans`);
  else try { await command(["docker", ...compose, "down", "--volumes", "--remove-orphans"], true); } catch (error) { console.error(error); process.exitCode = 1; }
}
