import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentGitSignal, GitCommandError, parseRefList, runGit, type GitCredentials } from "./git";
import type { PushMirrorPlan } from "./engine";
import type { PushTargetRepository } from "./targets/types";

export class PendingApprovalError extends Error {
  constructor(public readonly changes: string[]) { super(`History rewrite requires approval: ${changes.join(", ")}`); this.name = "PendingApprovalError"; }
}

export interface HFTransferOptions {
  lfs: boolean;
  strategy: "disabled" | "always" | "on-force-push" | "block-on-force-push";
  approved?: boolean;
  blockOnBackupFailure?: boolean;
  backupDirectory: string;
  retentionCount: number;
  retentionDays: number;
  archiveDirectory: string;
  sourceIdentity: string;
}

const refArgs = ["refs/heads/*", "refs/tags/*", "refs/hf-mirror/pr/*"];
export async function remoteRefs(url: string, credentials: GitCredentials | null) {
  return parseRefList((await runGit(["ls-remote", "--refs", url, ...refArgs], { credentials })).stdout);
}

/** Back up destination history before a force update, including dropped branches and moved tags. */
export async function protectHFHistory(plan: PushMirrorPlan, target: PushTargetRepository, wanted: Map<string, string>) {
  const options = plan.hf!;
  const before = await remoteRefs(target.pushUrl, plan.target.pushCredentials());
  if (!before.size || options.strategy === "disabled") return;
  await runGit(["-C", plan.clonePath, "fetch", "--no-tags", target.pushUrl,
    "+refs/heads/*:refs/hf-target/heads/*", "+refs/tags/*:refs/hf-target/tags/*", "+refs/hf-mirror/pr/*:refs/hf-target/pr/*"],
    { credentials: plan.target.pushCredentials() });
  const destructive: string[] = [];
  for (const [ref, oldSha] of before) {
    const next = wanted.get(ref);
    if (next === oldSha) continue;
    if (!next || !ref.startsWith("refs/heads/")) { destructive.push(ref); continue; }
    try { await runGit(["-C", plan.clonePath, "merge-base", "--is-ancestor", oldSha, next]); }
    catch (error) {
      if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
      destructive.push(ref);
    }
  }
  if (destructive.length && options.strategy === "block-on-force-push" && !options.approved) throw new PendingApprovalError(destructive);
  if (options.strategy !== "always" && !destructive.length && !options.approved) return;
  if (options.lfs) {
    await runGit(["-C", plan.clonePath, "remote", "remove", "hf-safety"]).catch(() => {});
    await runGit(["-C", plan.clonePath, "remote", "add", "hf-safety", target.pushUrl]);
    const revisions = [...new Set(before.values())];
    for (let i = 0; i < revisions.length; i += 100) {
      await runGit(["-c", `lfs.url=${target.pushUrl}/info/lfs`, "-c", `remote.hf-safety.lfsurl=${target.pushUrl}/info/lfs`,
        "-C", plan.clonePath, "lfs", "fetch", "--all", "hf-safety", ...revisions.slice(i, i + 100)],
        { credentials: plan.target.pushCredentials(), onProgress: plan.log, timeoutMs: 24 * 3600_000 });
    }
  }
  const root = path.resolve(options.backupDirectory);
  await mkdir(root, { recursive: true });
  // Names use a hash, avoiding user-controlled paths and cross-repository retention.
  const key = createHash("sha256").update(options.sourceIdentity).digest("hex").slice(0, 24);
  const bundle = path.join(root, `${key}-${Date.now()}.bundle`);
  await runGit(["-C", plan.clonePath, "bundle", "create", bundle, "--all"]);
  await writeFile(`${bundle}.json`, JSON.stringify({ source: options.sourceIdentity, refs: Object.fromEntries(before), lfsObjects: "Retained in the persistent mirror clone's lfs/objects directory" }, null, 2));
  const files = (await readdir(root)).filter(f => f.startsWith(`${key}-`) && f.endsWith(".bundle")).sort().reverse();
  for (let i = 0; i < files.length; i++) {
    const file = path.join(root, files[i]);
    const age = Date.now() - (await stat(file)).mtimeMs;
    if (i > 0 && (i >= options.retentionCount || (options.retentionDays > 0 && age > options.retentionDays * 86400_000))) {
      await unlink(file); await unlink(`${file}.json`).catch(() => {});
    }
  }
  plan.log?.(`Safety snapshot: ${bundle}`);
}

interface LFSObject { oid: string; size: number }
export async function lfsObjects(plan: PushMirrorPlan): Promise<LFSObject[]> {
  const { stdout } = await runGit(["-C", plan.clonePath, "lfs", "ls-files", "--all", "--json"]);
  const parsed = JSON.parse(stdout || "[]");
  const entries: LFSObject[] = Array.isArray(parsed) ? parsed : parsed.files;
  if (!Array.isArray(entries)) throw new Error("Unexpected Git LFS inventory format");
  const unique = new Map<string, LFSObject>();
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.oid) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("Invalid Git LFS object inventory");
    unique.set(entry.oid, { oid: entry.oid, size: entry.size });
  }
  return [...unique.values()];
}

export async function verifyLocal(plan: PushMirrorPlan, objects: LFSObject[]) {
  for (const object of objects) {
    const location = path.join(plan.clonePath, "lfs", "objects", object.oid.slice(0, 2), object.oid.slice(2, 4), object.oid);
    if ((await stat(location)).size !== object.size) throw new Error(`Incomplete LFS object ${object.oid}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(location)) hash.update(chunk);
    if (hash.digest("hex") !== object.oid) throw new Error(`Corrupt LFS object ${object.oid}`);
  }
}

async function verifyDestination(plan: PushMirrorPlan, pushUrl: string, objects: LFSObject[]) {
  const credentials = plan.target.pushCredentials();
  const batchUrl = `${pushUrl}/info/lfs/objects/batch`;
  for (let i = 0; i < objects.length; i += 100) {
    const batch = objects.slice(i, i + 100);
    const response = await fetch(batchUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(currentGitSignal() ? [currentGitSignal()!] : [])]),
      headers: { "Content-Type": "application/vnd.git-lfs+json", Accept: "application/vnd.git-lfs+json",
        ...(credentials ? { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")}` } : {}) },
      body: JSON.stringify({ operation: "download", transfers: ["basic"], objects: batch }),
    });
    if (!response.ok) throw new Error(`Destination LFS verification failed (${response.status})`);
    const payload = await response.json() as { objects?: (LFSObject & { error?: unknown; actions?: { download?: unknown } })[] };
    for (const wanted of batch) {
      const found = payload.objects?.find(o => o.oid === wanted.oid);
      if (!found || found.error || found.size !== wanted.size || !found.actions?.download) throw new Error(`Destination is missing LFS object ${wanted.oid}`);
    }
  }
}

export async function transferHFLargeFiles(plan: PushMirrorPlan, pushUrl: string) {
  if (!plan.hf?.lfs) { plan.log?.("Git-only backup: large-file objects are excluded"); return; }
  const sourceLfs = `${plan.sourceCloneUrl}/info/lfs`;
  const targetLfs = `${pushUrl}/info/lfs`;
  // Override repository-provided LFS endpoints so each credential is only used with its own host.
  const sourceConfig = ["-c", `lfs.url=${sourceLfs}`, "-c", `remote.origin.lfsurl=${sourceLfs}`];
  plan.log?.("Fetching all historical LFS/Xet objects");
  await retryTransfer(() => runGit([...sourceConfig, "-C", plan.clonePath, "lfs", "fetch", "--all", "origin"], { credentials: plan.sourceCredentials, onProgress: plan.log, timeoutMs: 24 * 3600_000 }), plan.log);
  const objects = await lfsObjects(plan);
  plan.log?.(`Verifying ${objects.length} local large-file objects`);
  await verifyLocal(plan, objects);
  await runGit(["-C", plan.clonePath, "remote", "remove", "hf-backup"]).catch(() => {});
  await runGit(["-C", plan.clonePath, "remote", "add", "hf-backup", pushUrl]);
  plan.log?.(`Uploading ${objects.length} verified large-file objects`);
  // `push --all` only walks local branches/tags, unlike `fetch --all`.
  // HF PR refs can be the sole owners of a weight object. Upload the verified
  // inventory explicitly, in bounded batches that also fit Windows argv limits.
  for (let i = 0; i < objects.length; i += 100) {
    const batch = objects.slice(i, i + 100).map(object => object.oid);
    await retryTransfer(() => runGit(["-c", `lfs.url=${targetLfs}`, "-c", `remote.hf-backup.lfsurl=${targetLfs}`, "-C", plan.clonePath, "lfs", "push", "--object-id", "hf-backup", ...batch], { credentials: plan.target.pushCredentials(), onProgress: plan.log, timeoutMs: 24 * 3600_000 }), plan.log);
  }
  await verifyDestination(plan, pushUrl, objects);
  plan.log?.("Large-file objects verified at destination");
}

async function retryTransfer<T>(action: () => Promise<T>, log?: (message: string) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    currentGitSignal()?.throwIfAborted();
    try { return await action(); }
    catch (error) {
      if (attempt >= 2 || /401|403|authentication|permission denied/i.test(String(error))) throw error;
      log?.(`Transfer interrupted; retaining partial objects and retrying (${attempt + 1}/2)`);
      await delay(2 ** attempt * 1000, undefined, { signal: currentGitSignal() });
    }
  }
}

export async function verifyHFRefs(plan: PushMirrorPlan, pushUrl: string, wanted: Map<string, string>) {
  const found = await remoteRefs(pushUrl, plan.target.pushCredentials());
  if (found.size !== wanted.size || [...wanted].some(([ref, sha]) => found.get(ref) !== sha)) throw new Error("Destination ref verification failed; backup is incomplete");
  await mkdir(plan.hf!.archiveDirectory, { recursive: true });
  const manifest = { version: 1, source: plan.hf!.sourceIdentity, backedUpAt: new Date().toISOString(),
    git: "complete", largeFiles: plan.hf!.lfs ? "complete" : "excluded", refs: Object.fromEntries(wanted),
    objects: plan.hf!.lfs ? await lfsObjects(plan) : [] };
  await writeFile(path.join(plan.hf!.archiveDirectory, "transfer.json"), JSON.stringify(manifest, null, 2));
}
