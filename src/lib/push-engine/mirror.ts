/**
 * The database aware side of the push engine.
 *
 * Records HF transfers in the statuses, jobs and activity rows used by the
 * dashboard, recovery and cleanup. The Git work lives in engine.ts.
 */
import { HuggingFaceSourceProvider } from "@/lib/source-providers/huggingface";
import { currentGitSignal } from "./git";
import { createHash } from "node:crypto";
import path from "node:path";
import { PendingApprovalError } from "./hf-transfer";
import { resolveDataDir } from "./paths";
import { resolveMirrorOptionsForRepository } from "@/lib/utils/mirror-overrides";
import { archiveHFMetadata } from "@/lib/hf-metadata";
import { eq } from "drizzle-orm";
import { db, repositories } from "@/lib/db";
import type { Config, Repository } from "@/lib/db/schema";
import { createMirrorJob } from "@/lib/helpers";
import { getGiteaRepoOwnerAsync } from "@/lib/destination-api";
import {
  assertRepositoryMatchesConnectedSource,
  sourceConnectionFromSource,
} from "@/lib/source-providers";
import type { SourceRecord } from "@/lib/sources";
import {
  decryptSourceToken,
  findSourceForRepository,
  listSources,
} from "@/lib/sources";
import { buildSourceAuthPayload } from "@/lib/utils/mirror-source-auth";
import {
  assertRepositoryMatchesConfiguredDestination,
  createPushTargetFromConfig,
  resolveDestinationIdentity,
  resolvePushDestinationKind,
} from "@/lib/destination-connection";
import { DESTINATION_PROVIDER_LABELS } from "@/lib/destination-kinds";
import { repoStatusEnum } from "@/types/Repository";
import { runPushMirror, type PushMirrorOutcome } from "./engine";
import { withGitCancellation, MirrorCancelledError, type GitCredentials } from "./git";

const activeMirrors = new Map<string, { userId: string; controller: AbortController }>();
export function cancelActiveMirror(id: string, userId: string): boolean {
  const active = activeMirrors.get(id);
  if (!active || active.userId !== userId) return false;
  active.controller.abort(new MirrorCancelledError());
  return true;
}
export async function pushMirrorRepository(input: PushMirrorRepositoryOptions): Promise<PushMirrorOutcome> {
  if (activeMirrors.has(input.repository.id)) throw new Error("A mirror is already active for this repository");
  const controller = new AbortController();
  activeMirrors.set(input.repository.id, { userId: input.config.userId!, controller });
  try { return await withGitCancellation(controller.signal, () => executePushMirrorRepository(input)); }
  finally { activeMirrors.delete(input.repository.id); }
}
import { clonePathForRepository } from "./paths";
import type { PushTarget } from "./targets/types";

export type PushMirrorMode = "mirror" | "sync";

export interface PushMirrorRepositoryOptions {
  config: Partial<Config>;
  repository: Repository;
  /** "mirror" for the first push, "sync" for later ones. Picks statuses and the job type. */
  mode?: PushMirrorMode;
  approved?: boolean;
  /** Test hook: use this target instead of the one built from the config. */
  target?: PushTarget;
}

/** Split a recorded `owner/name` mirror location. */
export function parseMirroredLocation(location: string | null | undefined): { owner: string; name: string } | null {
  const trimmed = (location || "").trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return { owner: trimmed.slice(0, slash), name: trimmed.slice(slash + 1) };
}

/**
 * The credentials git uses to fetch from the source, from the repository's
 * own source row. Sources are loaded once per push by the caller and passed
 * down so batches never query per repository.
 */
export function resolveSourceCredentials(
  config: Partial<Config>,
  repository: Repository,
  sources: SourceRecord[]
): GitCredentials | null {
  const source = findSourceForRepository(repository, sources);
  if (!source) return null;
  const connection = sourceConnectionFromSource(source, { userId: config.userId });
  const payload = buildSourceAuthPayload({
    provider: connection.provider,
    token: decryptSourceToken(source.token),
    username: connection.username,
    repositoryOwner: repository.owner,
  });
  if (!("auth_username" in payload) || !payload.auth_password) return null;
  return { username: payload.auth_username, token: payload.auth_password };
}

/** Private on the target unless the source repository is public and visibility is preserved. */
export function resolveTargetPrivacy(config: Partial<Config>, repository: Repository): boolean {
  if (repository.isGated || repository.isPrivate || repository.visibility === "private" || repository.visibility === "internal") {
    return true;
  }
  const preserve = config.giteaConfig?.preserveVisibility ?? true;
  if (preserve) return false;
  return config.giteaConfig?.visibility === "private";
}

async function executePushMirrorRepository({
  config,
  repository,
  mode,
  target,
  approved,
}: PushMirrorRepositoryOptions): Promise<PushMirrorOutcome> {
  if (!config.userId || !config.giteaConfig?.url || !config.giteaConfig?.token) {
    throw new Error("A destination URL and token are required.");
  }
  if (!config.giteaConfig.defaultOwner) {
    throw new Error("The destination account name is required.");
  }

  const kind = resolvePushDestinationKind(config);
  const label = DESTINATION_PROVIDER_LABELS[kind];
  const destination = resolveDestinationIdentity(config);

  // Never send another host's token in either direction: the repository
  // must come from one of the connected sources, and its own source's
  // credentials are used below.
  const sources = await listSources(config.userId);
  assertRepositoryMatchesConnectedSource({ repository, sources });
  assertRepositoryMatchesConfiguredDestination({ repository, config });

  const recorded = parseMirroredLocation(repository.mirroredLocation);
  const effectiveMode: PushMirrorMode = mode ?? (recorded ? "sync" : "mirror");
  const owner = recorded?.owner ?? (await getGiteaRepoOwnerAsync({ config, repository, sourceUsername: findSourceForRepository(repository, sources)?.username }));
  const hf = repository.sourceProvider === "huggingface";
  const name = recorded?.name ?? repository.name;
  const options = await resolveMirrorOptionsForRepository({ config, repository });
  const identity = `${repository.sourceUrl}|${repository.repoType}|${repository.fullName}`;
  const archiveDirectory = path.join(resolveDataDir(), "archives", repository.id);
  const marker = `[HF-mirror:${createHash("sha256").update(identity).digest("hex")}]`;
  const location = `${owner}/${name}`;
  const busyStatus = effectiveMode === "mirror" ? "mirroring" : "syncing";
  const doneStatus = effectiveMode === "mirror" ? "mirrored" : "synced";
  const jobType = effectiveMode === "mirror" ? "mirror" : "sync";
  const logPrefix = `[Push ${label}] ${repository.fullName}:`;

  await db
    .update(repositories)
    .set({
      status: repoStatusEnum.parse(busyStatus),
      mirroredLocation: location,
      destinationProvider: destination.provider,
      destinationUrl: destination.url,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repository.id!));

  await createMirrorJob({
    userId: config.userId,
    repositoryId: repository.id,
    repositoryName: repository.name,
    message:
      effectiveMode === "mirror"
        ? `Started mirroring repository: ${repository.name}`
        : `Started syncing repository: ${repository.name}`,
    details: `Repository ${repository.fullName} is being pushed to ${label} at ${location}.`,
    status: busyStatus,
    jobType,
  });

  let gitComplete = false;
  let progressWrites = Promise.resolve();
  let lastProgressWrite = 0;
  const reportProgress = (message: string) => {
    console.info(`${logPrefix} ${message}`);
    if (Date.now() - lastProgressWrite < 1000) return;
    lastProgressWrite = Date.now();
    progressWrites = progressWrites.then(async () => {
      await db.update(repositories).set({ metadata: JSON.stringify({ hf: { git: gitComplete ? "complete" : "running", largeFiles: options.lfs ? "running" : "excluded", metadata: "pending", progress: message, progressAt: new Date().toISOString() } }), updatedAt: new Date() }).where(eq(repositories.id, repository.id));
    }).catch(error => console.warn("Could not persist mirror progress", error));
  };
  try {
    if (hf) {
      const source = findSourceForRepository(repository, sources)!;
      const fresh = await new HuggingFaceSourceProvider(sourceConnectionFromSource(source), currentGitSignal(), reportProgress).getRepository(repository.owner, repository.name, repository.repoType);
      repository = { ...repository, isPrivate: fresh.isPrivate, isGated: fresh.isGated ?? false, hasLFS: fresh.hasLFS, size: fresh.size };
      await db.update(repositories).set({ isPrivate: repository.isPrivate, isGated: repository.isGated, hasLFS: repository.hasLFS, size: repository.size }).where(eq(repositories.id, repository.id));
    }
    const outcome = await runPushMirror({
      clonePath: clonePathForRepository(repository),
      sourceCloneUrl: repository.cloneUrl,
      sourceCredentials: resolveSourceCredentials(config, repository, sources),
      target: target ?? createPushTargetFromConfig(config),
      owner,
      name,
      isPrivate: resolveTargetPrivacy(config, repository),
      description: hf ? `${marker} ${repository.url} ${(repository.description ?? "").slice(0, 700)}` : repository.description,
      hf: hf ? {
        lfs: options.lfs, strategy: config.giteaConfig.backupStrategy ?? "on-force-push", approved,
        backupDirectory: config.giteaConfig.backupDirectory || path.join(resolveDataDir(), "repo-backups"),
        blockOnBackupFailure: config.giteaConfig.blockSyncOnBackupFailure !== false,
        retentionCount: config.giteaConfig.backupRetentionCount ?? 5,
        retentionDays: config.giteaConfig.backupRetentionDays ?? 30,
        archiveDirectory, sourceIdentity: identity,
      } : undefined,
      defaultBranch: repository.defaultBranch,
      log: reportProgress,
    });

    gitComplete = true;
    currentGitSignal()?.throwIfAborted();
    reportProgress("Git and selected large-file content verified; archiving metadata");
    await progressWrites;
    if (hf) await archiveHFMetadata({ config, repository, sources, owner: outcome.targetRepository.owner, name: outcome.targetRepository.name, archiveDirectory, options, log: reportProgress });

    await progressWrites;
    currentGitSignal()?.throwIfAborted();
    const finalLocation = `${outcome.targetRepository.owner}/${outcome.targetRepository.name}`;
    await db
      .update(repositories)
      .set({
        status: repoStatusEnum.parse(doneStatus),
        updatedAt: new Date(),
        lastMirrored: new Date(),
        errorMessage: null,
        metadata: hf ? JSON.stringify({ hf: { git: "complete", largeFiles: options.lfs ? "complete" : "excluded", metadata: options.mirrorMetadata || options.mirrorIssues || options.mirrorPullRequests ? "complete" : "excluded", archivedAt: new Date().toISOString() } }) : repository.metadata,
        mirroredLocation: finalLocation,
        destinationProvider: destination.provider,
        destinationUrl: destination.url,
      })
      .where(eq(repositories.id, repository.id!));

    const summary =
      outcome.cloned || outcome.targetRepository.created
        ? `first push of ${outcome.refsAfter.size} refs`
        : outcome.pushed
          ? `${outcome.changedRefs} ref(s) updated`
          : "already up to date";
    await createMirrorJob({
      userId: config.userId,
      repositoryId: repository.id,
      repositoryName: repository.name,
      message:
        effectiveMode === "mirror"
          ? `Successfully mirrored repository: ${repository.name}`
          : `Successfully synced repository: ${repository.name}`,
      details: `Repository ${repository.fullName} was pushed to ${label} at ${finalLocation} (${summary}${
        outcome.batches ? `, in ${outcome.batches} batches` : ""
      }).`,
      status: doneStatus,
      jobType,
    });

    return outcome;
  } catch (error) {
    await progressWrites;
    const message = error instanceof Error ? error.message : "Unknown error";
    const failureStatus = currentGitSignal()?.aborted ? "ignored" : error instanceof PendingApprovalError ? "pending-approval" : "failed";
    console.error(`${logPrefix} failed: ${message}`);

    await db
      .update(repositories)
      .set({
        status: repoStatusEnum.parse(failureStatus),
        updatedAt: new Date(),
        errorMessage: message,
        metadata: hf ? JSON.stringify({ hf: { git: gitComplete ? "complete" : "incomplete", largeFiles: options.lfs ? (gitComplete ? "complete" : "incomplete") : "excluded", metadata: "incomplete", error: message } }) : repository.metadata,
      })
      .where(eq(repositories.id, repository.id!));

    await createMirrorJob({
      userId: config.userId,
      repositoryId: repository.id,
      repositoryName: repository.name,
      message:
        effectiveMode === "mirror"
          ? `Failed to mirror repository: ${repository.name}`
          : `Failed to sync repository: ${repository.name}`,
      details: `Repository ${repository.fullName} could not be pushed to ${label}. Error: ${message}`,
      status: failureStatus,
      jobType,
    });

    throw currentGitSignal()?.aborted ? currentGitSignal()!.reason : error;
  }
}
