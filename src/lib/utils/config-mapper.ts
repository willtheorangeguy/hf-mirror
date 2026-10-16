/**
 * Maps between UI config structure and database schema structure
 */

import type { HFSourceConfig, GiteaConfig, MirrorOptions, AdvancedOptions } from "@/types/config";
import {
  normalizeSourceProviderKind,
  normalizeSourceUrl,
} from "@/lib/source-providers/kinds";
import { normalizeDestinationProviderKind } from "@/lib/destination-kinds";
import { z } from "zod";
import { sourceConfigSchema, giteaConfigSchema, scheduleConfigSchema, cleanupConfigSchema } from "@/lib/db/schema";
import { parseInterval } from "@/lib/utils/duration-parser";
import { normalizeReleaseAssetLimit } from "@/lib/utils/mirror-overrides";
import { buildClockCronExpression, normalizeTimezone, parseClockCronExpression } from "@/lib/utils/schedule-utils";

// Use the actual database schema types
type DbSourceConfig = z.infer<typeof sourceConfigSchema>;
type DbGiteaConfig = z.infer<typeof giteaConfigSchema>;
type DbScheduleConfig = z.infer<typeof scheduleConfigSchema>;
type DbCleanupConfig = z.infer<typeof cleanupConfigSchema>;

function normalizeStarredLists(lists: string[] | undefined): string[] {
  if (!Array.isArray(lists)) return [];
  const deduped = new Set<string>();
  for (const list of lists) {
    const trimmed = list.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return [...deduped];
}

// Trim, drop blanks, and de-duplicate case-insensitively while preserving the
// first-seen casing of each organization name.
function normalizeOrgList(orgs: string[] | undefined): string[] {
  if (!Array.isArray(orgs)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const org of orgs) {
    if (typeof org !== "string") continue;
    const trimmed = org.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Maps UI config structure to database schema structure
 *
 * `existing` is the stored DB config (if any). Fields the Configuration form
 * doesn't expose (mirrorInterval, topics, templates, ...) are preserved from it
 * so a UI save can't silently reset values configured via environment variables
 * (e.g. SCHEDULE_INTERVAL, see issue #338).
 */
export function mapUiToDbConfig(
  sourceConfig: HFSourceConfig,
  giteaConfig: GiteaConfig,
  mirrorOptions: MirrorOptions,
  advancedOptions: AdvancedOptions,
  existing?: {
    sourceConfig?: Partial<DbSourceConfig>;
    giteaConfig?: Partial<DbGiteaConfig>;
  }
): { sourceConfig: DbSourceConfig; giteaConfig: DbGiteaConfig } {

  // from GH_API_URL. Other hosts store their normalized instance URL.
  const sourceProvider = normalizeSourceProviderKind(
    sourceConfig.provider ?? existing?.sourceConfig?.provider
  );
  const rawSourceUrl = sourceConfig.url ?? existing?.sourceConfig?.url ?? "";
  const sourceUrl =
    false || !rawSourceUrl.trim()
      ? undefined
      : normalizeSourceUrl(rawSourceUrl, sourceProvider);

  const dbSourceConfig: DbSourceConfig = {
    // Map username to owner field
    owner: sourceConfig.username,
    provider: sourceProvider,
    repoTypes: [...new Set<"model" | "dataset" | "space">(sourceConfig.repoTypes ?? existing?.sourceConfig?.repoTypes ?? ["model", "dataset", "space"])],
    collections: [...new Set(sourceConfig.collections ?? existing?.sourceConfig?.collections ?? [])],
    url: sourceUrl,
    type: existing?.sourceConfig?.type || "personal", // Not in UI; preserve stored value
    token: sourceConfig.token || "",

    // Map checkbox fields with proper names
    includeStarred: sourceConfig.mirrorStarred,
    includePrivate: sourceConfig.privateRepositories,
    includeCollaboratorRepos: sourceConfig.includeCollaboratorRepos ?? true,
    includeForks: !advancedOptions.skipForks, // Note: UI has skipForks, DB has includeForks
    skipForks: advancedOptions.skipForks, // Add skipForks field
    includeArchived: existing?.sourceConfig?.includeArchived ?? false, // Not in UI; preserve stored value
    includePublic: existing?.sourceConfig?.includePublic ?? true, // Not in UI; preserve stored value

    // Organization related fields — opt-in allowlist (empty = all org repos)
    includeOrganizations: normalizeOrgList(sourceConfig.includeOrganizations),

    // Starred repos organization
    starredReposOrg: giteaConfig.starredReposOrg,
    starredReposMode: giteaConfig.starredReposMode || "dedicated-org",
    starredLists: normalizeStarredLists(sourceConfig.starredLists),
    starredDuplicateStrategy: sourceConfig.starredDuplicateStrategy ?? "suffix",

    // Mirror strategy
    mirrorStrategy: giteaConfig.mirrorStrategy || "preserve",
    defaultOrg: giteaConfig.organization,

    // Advanced options
    starredCodeOnly: advancedOptions.starredCodeOnly,
    autoMirrorStarred: advancedOptions.autoMirrorStarred ?? false,
    skipPersonalRepos: advancedOptions.skipPersonalRepos ?? false,
  };

  // Map Gitea config to match database schema
  const dbGiteaConfig: DbGiteaConfig = {
    url: giteaConfig.url,
    provider: normalizeDestinationProviderKind(
      giteaConfig.provider ?? existing?.giteaConfig?.provider
    ),
    externalUrl: giteaConfig.externalUrl?.trim() || undefined,
    token: giteaConfig.token,
    defaultOwner: giteaConfig.username, // Map username to defaultOwner
    organization: giteaConfig.organization, // Add organization field
    hfReposOrg: giteaConfig.hfReposOrg === undefined
      ? existing?.giteaConfig?.hfReposOrg
      : giteaConfig.hfReposOrg.trim(),
    preserveOrgStructure: giteaConfig.mirrorStrategy === "preserve" || giteaConfig.mirrorStrategy === "mixed", // Add preserveOrgStructure field

    // Mirror interval — not in UI; preserve the stored value so a save doesn't
    // reset an env-configured SCHEDULE_INTERVAL back to the default (#338)
    mirrorInterval: existing?.giteaConfig?.mirrorInterval || "8h",
    lfs: mirrorOptions.mirrorLFS || false, // LFS mirroring option
    wiki: mirrorOptions.mirrorMetadata && mirrorOptions.metadataComponents.wiki,

    // Visibility settings
    visibility: giteaConfig.visibility || "default",
    preserveVisibility: existing?.giteaConfig?.preserveVisibility ?? false, // Not in UI; preserve stored value

    // Organization creation — not in UI; preserve stored value
    createOrg: existing?.giteaConfig?.createOrg ?? true,

    // Template settings (not in UI yet) — preserve stored values
    templateOwner: existing?.giteaConfig?.templateOwner,
    templateRepo: existing?.giteaConfig?.templateRepo,

    // Topics — not in UI; preserve stored values
    addTopics: existing?.giteaConfig?.addTopics ?? true,
    topicPrefix: existing?.giteaConfig?.topicPrefix,

    // Fork strategy — skipForks is the only UI control; keep an env-configured
    // "full-copy" instead of downgrading it, but reset a stale "skip" once the
    // user unchecks skipForks.
    forkStrategy: advancedOptions.skipForks
      ? "skip"
      : existing?.giteaConfig?.forkStrategy && existing.giteaConfig.forkStrategy !== "skip"
        ? existing.giteaConfig.forkStrategy
        : "reference",

    // Mirror options from UI
    issueConcurrency: giteaConfig.issueConcurrency ?? 3,
    pullRequestConcurrency: giteaConfig.pullRequestConcurrency ?? 5,
    mirrorReleases: mirrorOptions.mirrorReleases,
    releaseLimit: mirrorOptions.releaseLimit || 10,
    // null is a real value here ("assets for every mirrored release"), so
    // it is stored as such rather than dropped.
    releaseAssetLimit: normalizeReleaseAssetLimit(mirrorOptions.releaseAssetLimit) ?? null,
    mirrorMetadata: mirrorOptions.mirrorMetadata,
    mirrorIssues: mirrorOptions.mirrorMetadata && mirrorOptions.metadataComponents.issues,
    mirrorPullRequests: mirrorOptions.mirrorMetadata && mirrorOptions.metadataComponents.pullRequests,
    mirrorLabels: mirrorOptions.mirrorMetadata && mirrorOptions.metadataComponents.labels,
    mirrorMilestones: mirrorOptions.mirrorMetadata && mirrorOptions.metadataComponents.milestones,
    backupStrategy: giteaConfig.backupStrategy || "on-force-push",
    backupBeforeSync: giteaConfig.backupBeforeSync ?? true,
    backupRetentionCount: giteaConfig.backupRetentionCount ?? 5,
    backupRetentionDays: giteaConfig.backupRetentionDays ?? 30,
    backupDirectory: giteaConfig.backupDirectory?.trim() || undefined,
    blockSyncOnBackupFailure: giteaConfig.blockSyncOnBackupFailure ?? true,
  };

  return {
    sourceConfig: dbSourceConfig,
    giteaConfig: dbGiteaConfig,
  };
}

/**
 * Maps database schema structure to UI config structure
 */
export function mapDbToUiConfig(dbConfig: any): {
  sourceConfig: HFSourceConfig;
  giteaConfig: GiteaConfig;
  mirrorOptions: MirrorOptions;
  advancedOptions: AdvancedOptions;
} {

  const sourceConfig: HFSourceConfig = {
    provider: normalizeSourceProviderKind(dbConfig.sourceConfig?.provider),
    repoTypes: dbConfig.sourceConfig?.repoTypes ?? ["model", "dataset", "space"],
    collections: dbConfig.sourceConfig?.collections ?? [],
    url: dbConfig.sourceConfig?.url || "",
    username: dbConfig.sourceConfig?.owner || "", // Map owner to username
    token: dbConfig.sourceConfig?.token || "",
    privateRepositories: dbConfig.sourceConfig?.includePrivate || false, // Map includePrivate to privateRepositories
    includeCollaboratorRepos: dbConfig.sourceConfig?.includeCollaboratorRepos ?? true,
    includeOrganizations: normalizeOrgList(dbConfig.sourceConfig?.includeOrganizations),
    mirrorStarred: dbConfig.sourceConfig?.includeStarred || false, // Map includeStarred to mirrorStarred
    starredLists: normalizeStarredLists(dbConfig.sourceConfig?.starredLists),
    starredDuplicateStrategy: dbConfig.sourceConfig?.starredDuplicateStrategy ?? "suffix",
  };

  // Map from database Gitea config to UI fields
  const giteaConfig: GiteaConfig = {
    provider: normalizeDestinationProviderKind(dbConfig.giteaConfig?.provider),
    url: dbConfig.giteaConfig?.url || "",
    externalUrl: dbConfig.giteaConfig?.externalUrl || "",
    username: dbConfig.giteaConfig?.defaultOwner || "", // Map defaultOwner to username
    token: dbConfig.giteaConfig?.token || "",
    organization: dbConfig.sourceConfig?.defaultOrg || "hf-mirrors",
    hfReposOrg: dbConfig.giteaConfig?.hfReposOrg || "",
    visibility: dbConfig.giteaConfig?.visibility === "default" ? "public" : dbConfig.giteaConfig?.visibility || "public",
    starredReposOrg: dbConfig.sourceConfig?.starredReposOrg || "starred",
    starredReposMode: dbConfig.sourceConfig?.starredReposMode || "dedicated-org",
    preserveOrgStructure: dbConfig.giteaConfig?.preserveVisibility || false, // Map preserveVisibility
    mirrorStrategy: dbConfig.sourceConfig?.mirrorStrategy || "preserve",
    personalReposOrg: undefined, // Not stored in current schema
    issueConcurrency: dbConfig.giteaConfig?.issueConcurrency ?? 3,
    pullRequestConcurrency: dbConfig.giteaConfig?.pullRequestConcurrency ?? 5,
    backupStrategy: dbConfig.giteaConfig?.backupStrategy ||
      // Respect legacy backupBeforeSync: false → "disabled" mapping on round-trip
      (dbConfig.giteaConfig?.backupBeforeSync === false ? "disabled" : "on-force-push"),
    backupBeforeSync: dbConfig.giteaConfig?.backupBeforeSync ?? true,
    backupRetentionCount: dbConfig.giteaConfig?.backupRetentionCount ?? 5,
    backupRetentionDays: dbConfig.giteaConfig?.backupRetentionDays ?? 30,
    backupDirectory: dbConfig.giteaConfig?.backupDirectory || "data/repo-backups",
    blockSyncOnBackupFailure: dbConfig.giteaConfig?.blockSyncOnBackupFailure ?? true,
  };

  // Map mirror options from various database fields
  const mirrorOptions: MirrorOptions = {
    mirrorReleases: dbConfig.giteaConfig?.mirrorReleases || false,
    releaseLimit: dbConfig.giteaConfig?.releaseLimit || 10,
    releaseAssetLimit: normalizeReleaseAssetLimit(dbConfig.giteaConfig?.releaseAssetLimit) ?? null,
    mirrorLFS: dbConfig.giteaConfig?.lfs || false,
    mirrorMetadata: dbConfig.giteaConfig?.mirrorMetadata || false,
    metadataComponents: {
      issues: dbConfig.giteaConfig?.mirrorIssues || false,
      pullRequests: dbConfig.giteaConfig?.mirrorPullRequests || false,
      labels: dbConfig.giteaConfig?.mirrorLabels || false,
      milestones: dbConfig.giteaConfig?.mirrorMilestones || false,
      wiki: dbConfig.giteaConfig?.wiki || false,
    },
  };

  // Map advanced options
  const advancedOptions: AdvancedOptions = {
    skipForks: !(dbConfig.sourceConfig?.includeForks ?? true), // Invert includeForks to get skipForks
    // Support both old (skipStarredIssues) and new (starredCodeOnly) field names for backward compatibility
    starredCodeOnly: dbConfig.sourceConfig?.starredCodeOnly ?? (dbConfig.sourceConfig as any)?.skipStarredIssues ?? false,
    autoMirrorStarred: dbConfig.sourceConfig?.autoMirrorStarred ?? false,
    skipPersonalRepos: dbConfig.sourceConfig?.skipPersonalRepos ?? false,
  };

  return {
    sourceConfig,
    giteaConfig,
    mirrorOptions,
    advancedOptions,
  };
}

/**
 * Maps UI schedule config to database schema
 */
export function mapUiScheduleToDb(uiSchedule: any, existing?: DbScheduleConfig): DbScheduleConfig {
  // Preserve existing schedule config and only update fields controlled by the UI
  const base: DbScheduleConfig = existing
    ? { ...(existing as unknown as DbScheduleConfig) }
    : (scheduleConfigSchema.parse({}) as unknown as DbScheduleConfig);

  const baseInterval = typeof base.interval === "string"
    ? base.interval
    : String(base.interval ?? 86400);

  const timezone = normalizeTimezone(
    typeof uiSchedule.timezone === "string"
      ? uiSchedule.timezone
      : base.timezone || "UTC"
  );

  let intervalExpression = baseInterval;

  if (uiSchedule.scheduleMode === "clock") {
    const cronExpression = buildClockCronExpression(
      uiSchedule.startTime || "22:00",
      Number(uiSchedule.clockFrequencyHours || 24)
    );
    if (cronExpression) {
      intervalExpression = cronExpression;
    }
  } else if (typeof uiSchedule.intervalExpression === "string" && uiSchedule.intervalExpression.trim().length > 0) {
    intervalExpression = uiSchedule.intervalExpression.trim();
  } else if (typeof uiSchedule.interval === "number" && Number.isFinite(uiSchedule.interval) && uiSchedule.interval > 0) {
    intervalExpression = String(Math.floor(uiSchedule.interval));
  } else if (typeof uiSchedule.interval === "string" && uiSchedule.interval.trim().length > 0) {
    intervalExpression = uiSchedule.interval.trim();
  }

  const scheduleChanged = baseInterval !== intervalExpression || normalizeTimezone(base.timezone || "UTC") !== timezone;

  return {
    ...base,
    enabled: !!uiSchedule.enabled,
    interval: intervalExpression,
    timezone,
    autoMirror: typeof uiSchedule.autoMirror === "boolean" ? uiSchedule.autoMirror : base.autoMirror,
    nextRun: scheduleChanged ? undefined : base.nextRun,
  } as DbScheduleConfig;
}

/**
 * Maps database schedule config to UI format
 */
export function mapDbScheduleToUi(dbSchedule: DbScheduleConfig): any {
  // Handle null/undefined schedule config
  if (!dbSchedule) {
    return {
      enabled: false,
      interval: 86400, // Default to daily (24 hours)
      intervalExpression: "86400",
      scheduleMode: "interval",
      clockFrequencyHours: 24,
      startTime: "22:00",
      timezone: "UTC",
      autoMirror: false,
      lastRun: null,
      nextRun: null,
    };
  }

  const intervalExpression = typeof dbSchedule.interval === "string"
    ? dbSchedule.interval
    : String(dbSchedule.interval ?? 86400);
  const parsedClockSchedule = parseClockCronExpression(intervalExpression);

  // Parse interval supporting numbers (seconds), duration strings, and cron
  let intervalSeconds = 86400; // Default to daily (24 hours)
  try {
    const ms = parseInterval(
      typeof dbSchedule.interval === 'number'
        ? dbSchedule.interval
        : (dbSchedule.interval as unknown as string)
    );
    intervalSeconds = Math.max(1, Math.floor(ms / 1000));
  } catch (_e) {
    // Fallback to default if unparsable
    intervalSeconds = 86400;
  }

  return {
    enabled: dbSchedule.enabled || false,
    interval: intervalSeconds,
    intervalExpression,
    scheduleMode: parsedClockSchedule ? "clock" : "interval",
    clockFrequencyHours: parsedClockSchedule?.frequencyHours ?? 24,
    startTime: parsedClockSchedule?.startTime ?? "22:00",
    timezone: normalizeTimezone(dbSchedule.timezone || "UTC"),
    autoMirror: dbSchedule.autoMirror ?? false,
    lastRun: dbSchedule.lastRun || null,
    nextRun: dbSchedule.nextRun || null,
  };
}

/**
 * Maps UI cleanup config to database schema
 */
export function mapUiCleanupToDb(uiCleanup: any): DbCleanupConfig {
  const parsedRetention =
    typeof uiCleanup.retentionDays === "string"
      ? parseInt(uiCleanup.retentionDays, 10)
      : uiCleanup.retentionDays;
  const retentionSeconds = Number.isFinite(parsedRetention)
    ? parsedRetention
    : 604800;

  return {
    enabled: Boolean(uiCleanup.enabled),
    retentionDays: retentionSeconds,
    lastRun: uiCleanup.lastRun ?? null,
    nextRun: uiCleanup.nextRun ?? null,
  };
}

/**
 * Maps database cleanup config to UI format
 */
export function mapDbCleanupToUi(dbCleanup: DbCleanupConfig): any {
  // Handle null/undefined cleanup config
  if (!dbCleanup) {
    return {
      enabled: false,
      retentionDays: 604800,
      lastRun: null,
      nextRun: null,
    };
  }

  return {
    enabled: dbCleanup.enabled ?? false,
    retentionDays: dbCleanup.retentionDays ?? 604800,
    lastRun: dbCleanup.lastRun ?? null,
    nextRun: dbCleanup.nextRun ?? null,
  };
}
