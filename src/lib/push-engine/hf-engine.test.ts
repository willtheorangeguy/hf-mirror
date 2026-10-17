import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "./git";
import { runPushMirror, type PushMirrorPlan } from "./engine";
import { PendingApprovalError, remoteRefs, lfsObjects, verifyLocal } from "./hf-transfer";
import type { PushTarget } from "./targets/types";

let root: string;
let source: string;
let destination: string;
let plan: PushMirrorPlan;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "hf-mirror-test-"));
  source = path.join(root, "source"); destination = path.join(root, "target.git");
  await mkdir(source);
  await runGit(["init", "--initial-branch=main", source]);
  await runGit(["-C", source, "config", "user.name", "HF Test"]);
  await runGit(["-C", source, "config", "user.email", "hf@example.test"]);
  await writeFile(path.join(source, "README.md"), "# Model card\n");
  await runGit(["-C", source, "add", "."]);
  await runGit(["-C", source, "commit", "-m", "initial"]);
  await runGit(["-C", source, "tag", "v1"]);
  await runGit(["-C", source, "update-ref", "refs/pr/7", "HEAD"]);
  const target: PushTarget = {
    kind: "local", baseUrl: root, pushCredentials: () => null,
    testConnection: async () => ({ login: "test" }), getRepository: async () => null,
    ensureRepository: async () => {
      await runGit(["init", "--bare", destination]);
      return { owner: "test", name: "model", pushUrl: destination, htmlUrl: destination, isPrivate: true, archived: false, created: false };
    }, archiveRepository: async () => {}, deleteRepository: async () => {},
  };
  plan = { clonePath: path.join(root, "clone.git"), sourceCloneUrl: source, sourceCredentials: null,
    target, owner: "test", name: "model", isPrivate: true,
    hf: { lfs: false, strategy: "block-on-force-push", backupDirectory: path.join(root, "backups"),
      retentionCount: 5, retentionDays: 30, archiveDirectory: path.join(root, "archive"), sourceIdentity: "model:alice/model" } };
}, 30_000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test("HF backup preserves branches, tags and PR refs with a Git-only manifest", async () => {
  await runPushMirror(plan);
  const refs = await remoteRefs(destination, null);
  expect(refs.has("refs/heads/main")).toBe(true);
  expect(refs.has("refs/tags/v1")).toBe(true);
  expect(refs.has("refs/hf-mirror/pr/7")).toBe(true);
  const manifest = await Bun.file(path.join(root, "archive", "transfer.json")).json();
  expect(manifest.largeFiles).toBe("excluded");
}, 30_000);

test("history rewrite waits for approval and approval creates a safety snapshot", async () => {
  const before = await remoteRefs(destination, null);
  await writeFile(path.join(source, "README.md"), "# Rewritten\n");
  await runGit(["-C", source, "add", "."]);
  await runGit(["-C", source, "commit", "--amend", "-m", "rewrite"]);
  await expect(runPushMirror(plan)).rejects.toBeInstanceOf(PendingApprovalError);
  expect((await remoteRefs(destination, null)).get("refs/heads/main")).toBe(before.get("refs/heads/main"));
  await runPushMirror({ ...plan, hf: { ...plan.hf!, approved: true } });
  expect((await readdir(path.join(root, "backups"))).some(p => p.endsWith(".bundle"))).toBe(true);
  expect((await remoteRefs(destination, null)).get("refs/heads/main")).not.toBe(before.get("refs/heads/main"));
}, 30_000);

test("inventories a repository without LFS pointers as an empty list", async () => {
  expect(await lfsObjects({ ...plan, clonePath: path.join(source, ".git") })).toEqual([]);
}, 30_000);

test("inventories historical LFS pointers and rejects corrupt local objects", async () => {
  const content = Buffer.from("historical model weights");
  const oid = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  await writeFile(path.join(source, "weights.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${content.length}\n`);
  await runGit(["-C", source, "add", "."]);
  await runGit(["-C", source, "commit", "-m", "add weights pointer"]);
  const localPlan = { ...plan, clonePath: path.join(source, ".git") };
  const objects = await lfsObjects(localPlan);
  expect(objects).toEqual([{ oid, size: content.length }]);
  const dir = path.join(source, ".git", "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, oid), content);
  await verifyLocal(localPlan, objects);
  await writeFile(path.join(dir, oid), Buffer.alloc(content.length, 0));
  await expect(verifyLocal(localPlan, objects)).rejects.toThrow("Corrupt");
}, 30_000);

test("backs up historical LFS bytes over HTTP and restores them with the source offline", async () => {
  const content = Buffer.from("historical model weights");
  const oid = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  // The file is absent at HEAD, so a latest-files-only transfer would miss it.
  await runGit(["-C", source, "rm", "weights.bin"]);
  await runGit(["-C", source, "commit", "-m", "remove current weights"]);
  const prContent = Buffer.from("weights reachable only through an HF PR");
  const prOid = new Bun.CryptoHasher("sha256").update(prContent).digest("hex");
  await runGit(["-C", source, "checkout", "-b", "pr-only"]);
  await writeFile(path.join(source, "pr.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${prOid}\nsize ${prContent.length}\n`);
  await runGit(["-C", source, "add", "pr.bin"]);
  await runGit(["-C", source, "commit", "-m", "PR-only weights"]);
  await runGit(["-C", source, "update-ref", "refs/pr/8", "HEAD"]);
  await runGit(["-C", source, "checkout", "main"]);
  await runGit(["-C", source, "branch", "-D", "pr-only"]);
  await runGit(["clone", "--bare", source, path.join(root, "source-http.git")]);
  await runGit(["-C", source, "push", path.join(root, "source-http.git"), "refs/pr/8"]);
  await runGit(["init", "--bare", path.join(root, "target-http.git")]);
  await runGit(["-C", path.join(root, "target-http.git"), "config", "http.receivepack", "true"]);
  const uploaded = new Map<string, Uint8Array>();
  const sourceObjects = new Map([[oid, content], [prOid, prContent]]);
  let sourceOffline = false;
  let deniedSourceRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const isSource = url.pathname.startsWith("/source-http.git/") || url.pathname.startsWith("/objects/source/");
      if (sourceOffline && isSource) { deniedSourceRequests++; return new Response("Offline", { status: 503 }); }
      if (url.pathname.endsWith("/info/lfs/objects/batch")) {
        const body = await request.json() as { operation: string; objects: { oid: string; size: number }[] };
        return Response.json({ transfer: "basic", objects: body.objects.map(object => {
          const available = isSource ? sourceObjects.has(object.oid) : uploaded.has(object.oid);
          if (body.operation === "download" && !available) return { ...object, error: { code: 404, message: "Missing object" } };
          return { ...object, actions: { [body.operation]: { href: `${url.origin}/objects/${isSource ? "source" : "target"}/${object.oid}` } } };
        }) });
      }
      if (url.pathname.startsWith("/objects/")) {
        const objectId = url.pathname.split("/").at(-1)!;
        if (request.method === "PUT") { uploaded.set(objectId, new Uint8Array(await request.arrayBuffer())); return new Response(null, { status: 200 }); }
        const bytes = isSource ? sourceObjects.get(objectId) : uploaded.get(objectId);
        return bytes ? new Response(new Uint8Array(bytes)) : new Response("Missing", { status: 404 });
      }
      // Real Git smart HTTP backend; only the LFS storage API above is a fixture.
      const child = Bun.spawn(["git", "http-backend"], {
        env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname,
          REQUEST_METHOD: request.method, QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: request.headers.get("content-type") ?? "", SERVER_PROTOCOL: "HTTP/1.1",
          REMOTE_ADDR: "127.0.0.1", REMOTE_USER: "fixture" },
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      child.stdin.write(new Uint8Array(await request.arrayBuffer())); child.stdin.end();
      const output = Buffer.from(await new Response(child.stdout).arrayBuffer());
      const errors = await new Response(child.stderr).text();
      if (await child.exited !== 0) return new Response(errors, { status: 500 });
      const separator = output.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
      const split = output.indexOf(separator);
      const headers = new Headers(); let statusCode = 200;
      for (const line of output.subarray(0, split).toString().split(/\r?\n/)) {
        const colon = line.indexOf(":"); if (colon < 0) continue;
        if (line.slice(0, colon).toLowerCase() === "status") statusCode = Number(line.slice(colon + 1).trim().split(" ")[0]);
        else headers.set(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      return new Response(output.subarray(split + separator.length), { status: statusCode, headers });
    },
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const target: PushTarget = { ...plan.target, baseUrl,
      ensureRepository: async () => ({ owner: "test", name: "model", pushUrl: `${baseUrl}/target-http.git`, htmlUrl: baseUrl, isPrivate: true, archived: false, created: false }) };
    const fullPlan = { ...plan, sourceCloneUrl: `${baseUrl}/source-http.git`, clonePath: path.join(root, "full.git"), target,
      hf: { ...plan.hf!, lfs: true } };
    await runPushMirror(fullPlan);
    expect(Buffer.from(uploaded.get(oid)!)).toEqual(content);
    expect(Buffer.from(uploaded.get(prOid)!)).toEqual(prContent);
    const manifest = await Bun.file(path.join(root, "archive", "transfer.json")).json();
    expect(manifest.objects).toContainEqual({ oid, size: content.length });
    expect(manifest.objects).toContainEqual({ oid: prOid, size: prContent.length });
    const completeRefs = await remoteRefs(`${baseUrl}/target-http.git`, null);
    const missingOid = "f".repeat(64);
    await writeFile(path.join(source, "missing.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${missingOid}\nsize 10\n`);
    await runGit(["-C", source, "add", "missing.bin"]);
    await runGit(["-C", source, "commit", "-m", "reference unavailable historical data"]);
    await runGit(["-C", source, "push", path.join(root, "source-http.git"), "main"]);
    await expect(runPushMirror(fullPlan)).rejects.toThrow();
    expect((await remoteRefs(`${baseUrl}/target-http.git`, null)).get("refs/heads/main")).toBe(completeRefs.get("refs/heads/main"));
    sourceOffline = true;
    const restored = path.join(root, "restore.git");
    await runGit(["clone", "--mirror", `${baseUrl}/target-http.git`, restored]);
    await runGit(["-c", `lfs.url=${baseUrl}/target-http.git/info/lfs`, "-C", restored, "lfs", "fetch", "--all", "origin"]);
    const restoredObject = await Bun.file(path.join(restored, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid)).arrayBuffer();
    expect(Buffer.from(restoredObject)).toEqual(content);
    const restoredPr = await Bun.file(path.join(restored, "lfs", "objects", prOid.slice(0, 2), prOid.slice(2, 4), prOid)).arrayBuffer();
    expect(Buffer.from(restoredPr)).toEqual(prContent);
    expect(deniedSourceRequests).toBe(0);
  } finally { server.stop(true); }
}, 60_000);
