import { and, eq } from "drizzle-orm";
import { db, repositories } from "./db";
import type { Config } from "./db/schema";
import { GiteaPushTarget } from "./push-engine/targets/gitea";
import { resolveDestinationConnection, resolveDestinationIdentity } from "./destination-connection";
import { isRepositoryOnConfiguredDestination } from "./destination-kinds";
import { hfMarker, isHFDestinationRepository } from "./hf-identity";
import { listSources } from "./sources";
import { sourceConnectionFromSource } from "./source-providers";
import { HuggingFaceSourceProvider, resolveHFRepositoryPath } from "./source-providers/huggingface";
import { normalizeGitRepoToInsert, repositoryDestinationColumns } from "./repo-utils";
import type { ReconcileOptions, ReconcileResult, ReconcileReport } from "./reconcile-types";

export interface HFDestinationRepo { id: number; name: string; full_name: string; owner: { login: string }; description?: string; private: boolean; mirror: boolean }
export async function listHFDestinationRepositories(config: Partial<Config>): Promise<HFDestinationRepo[]> {
  const target = new GiteaPushTarget(resolveDestinationConnection(config));
  const result: HFDestinationRepo[] = [];
  for (let page = 1; page <= 10_000; page++) {
    const batch = await target.api<HFDestinationRepo[]>(`/user/repos?limit=50&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Invalid Gitea repository inventory");
    result.push(...batch);
    if (batch.length < 50) return result;
  }
  throw new Error("Destination inventory is incomplete");
}

export async function reconcileHF(config: Partial<Config>, options: ReconcileOptions): Promise<ReconcileResult> {
  const destination = resolveDestinationIdentity(config);
  const target = new GiteaPushTarget(resolveDestinationConnection(config));
  const inventory = await listHFDestinationRepositories(config);
  const rows = await db.select().from(repositories).where(eq(repositories.userId, config.userId!));
  const report: ReconcileReport = { untracked: [], missing: [], moved: [], notManaged: [], unverified: [], healthyCount: 0,
    elsewhereCount: 0, scannedOwners: [...new Set(inventory.map(r => r.owner.login))], skippedOwners: [], totalOnDestination: inventory.length };
  const applied = { adopted: 0, reset: 0, relocated: 0, skipped: 0 };
  const used = new Set<string>();
  for (const row of rows) {
    if (row.sourceProvider !== "huggingface" || !isRepositoryOnConfiguredDestination(row, destination)) { report.elsewhereCount++; continue; }
    const hits = inventory.filter(repo => isHFDestinationRepository(repo, row));
    if (hits.length > 1) { report.unverified.push({ fullName: row.fullName, location: row.mirroredLocation ?? "", error: "Multiple destination repositories have the same source marker" }); continue; }
    const hit = hits[0];
    if (hit) {
      used.add(hit.full_name);
      if (hit.full_name === row.mirroredLocation) report.healthyCount++;
      else {
        report.moved.push({ id: row.id, fullName: row.fullName, from: row.mirroredLocation ?? "", to: hit.full_name });
        if (!options.dryRun && options.relocateMoved && !["mirroring", "syncing"].includes(row.status)) {
          await db.update(repositories).set({ mirroredLocation: hit.full_name, updatedAt: new Date() }).where(and(eq(repositories.id, row.id), eq(repositories.userId, config.userId!)));
          applied.relocated++;
        }
      }
    } else if (row.mirroredLocation) {
      const [owner, name] = row.mirroredLocation.split("/");
      try {
        if (await target.getRepository(owner, name)) { report.unverified.push({ fullName: row.fullName, location: row.mirroredLocation, error: "Recorded destination has a different source marker" }); continue; }
        report.missing.push({ id: row.id, fullName: row.fullName, location: row.mirroredLocation });
        if (!options.dryRun && options.resetMissing && !["mirroring", "syncing"].includes(row.status)) {
          await db.update(repositories).set({ mirroredLocation: "", status: "imported", errorMessage: "Destination missing; awaiting a new verified backup", updatedAt: new Date() }).where(and(eq(repositories.id, row.id), eq(repositories.userId, config.userId!)));
          applied.reset++;
        }
      } catch (error) { report.unverified.push({ fullName: row.fullName, location: row.mirroredLocation, error: String(error) }); }
    }
  }
  const sources = (await listSources(config.userId!)).filter(source => source.enabled);
  for (const repo of inventory) {
    if (used.has(repo.full_name)) continue;
    const match = repo.description?.match(/^\[HF-mirror:[a-f0-9]{64}\] (https?:\/\/\S+)/);
    if (!match) { report.notManaged.push({ location: repo.full_name, reason: "No HF-mirror provenance" }); continue; }
    let url: URL;
    try { url = new URL(match[1]); }
    catch { report.notManaged.push({ location: repo.full_name, reason: "Invalid HF provenance URL" }); continue; }
    const source = sources.find(s => s.url === url.origin);
    const origin = resolveHFRepositoryPath(url.pathname.split("/").filter(Boolean));
    if (!source || !origin || !repo.description?.startsWith(hfMarker({ sourceUrl: source.url, repoType: origin.repoType, fullName: `${origin.owner}/${origin.repo}` }))) {
      report.notManaged.push({ location: repo.full_name, reason: "Source is not connected or provenance does not match" }); continue;
    }
    if (rows.some(row => isHFDestinationRepository(repo, row))) continue;
    report.untracked.push({ location: repo.full_name, originalUrl: url.toString(), sourcePath: `${origin.repoType}:${origin.owner}/${origin.repo}`, isPrivate: !!repo.private });
    if (!options.dryRun && options.adoptUntracked) {
      try {
        const fromSource = await new HuggingFaceSourceProvider(sourceConnectionFromSource(source)).getRepository(origin.owner, origin.repo, origin.repoType);
        if ((fromSource.isPrivate || fromSource.isGated) && !repo.private) throw new Error("Private/gated source has a public destination");
        const insert = normalizeGitRepoToInsert(fromSource, { userId: config.userId!, configId: config.id!, sourceId: source.id });
        await db.insert(repositories).values({ ...insert, ...repositoryDestinationColumns(destination), mirroredLocation: repo.full_name }).onConflictDoNothing();
        applied.adopted++;
      } catch (error) { applied.skipped++; report.unverified.push({ fullName: `${origin.owner}/${origin.repo}`, location: repo.full_name, error: String(error) }); }
    }
  }
  return { dryRun: options.dryRun, report, applied: options.dryRun ? null : applied };
}
