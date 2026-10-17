import { and, eq } from "drizzle-orm";
import { db, organizations } from "./db";
import type { Repository } from "./db/schema";
import type { Config } from "@/types/config";
import { HttpError, httpGet, httpPost } from "./http-client";
import { decryptConfigTokens } from "./utils/config-encryption";
import { listHFDestinationRepositories } from "./hf-reconcile";
import { isHFDestinationRepository } from "./hf-identity";

export interface GiteaRepoInfo {
  id: number;
  name: string;
  owner: { login: string } | string;
  mirror: boolean;
  private: boolean;
  description?: string;
  topics?: string[];
  original_url?: string;
  clone_url?: string;
  repo_transfer?: { recipient?: { login?: string; username?: string } | null } | null;
}

export interface GiteaTransferResult { pending: boolean; repo: GiteaRepoInfo }

export function getGiteaRepoOwner({ config, repository, sourceUsername }: {
  config: Partial<Config>; repository: Repository; sourceUsername?: string;
}): string {
  if (!config.sourceConfig || !config.giteaConfig?.defaultOwner) {
    throw new Error("HF source and destination username are required");
  }
  const source = config.sourceConfig;
  const destination = config.giteaConfig;
  if (repository.destinationOrg) return repository.destinationOrg;
  // Explicit repository/organization overrides win; this default also covers likes.
  const hfReposOrg = destination.hfReposOrg?.trim();
  if (repository.sourceProvider === "huggingface" && hfReposOrg) return hfReposOrg;
  if (repository.isStarred) {
    return source.starredReposMode === "preserve-owner"
      ? repository.organization || repository.owner : source.starredReposOrg || "liked";
  }
  const strategy = source.mirrorStrategy || (destination.preserveOrgStructure ? "preserve" : "flat-user");
  if (strategy === "preserve") {
    if (repository.organization) return repository.organization;
    const account = (sourceUsername ?? source.owner ?? "").trim().toLowerCase();
    if (account && repository.owner.toLowerCase() !== account) return repository.owner;
  }
  if (strategy === "mixed" && repository.organization) return repository.organization;
  if (strategy === "single-org" || strategy === "mixed") return destination.organization || destination.defaultOwner;
  return destination.defaultOwner;
}

export async function getGiteaRepoOwnerAsync(args: {
  config: Partial<Config>; repository: Repository; sourceUsername?: string;
}): Promise<string> {
  const { config, repository } = args;
  if (!config.userId) throw new Error("User ID is required");
  if (repository.organization && !repository.isStarred && !repository.destinationOrg) {
    const [organization] = await db.select().from(organizations)
      .where(and(eq(organizations.name, repository.organization), eq(organizations.userId, config.userId))).limit(1);
    if (organization?.destinationOrg) return organization.destinationOrg;
  }
  return getGiteaRepoOwner(args);
}

function headers(config: Partial<Config>) {
  if (!config.giteaConfig?.url || !config.giteaConfig.token) throw new Error("Destination configuration is required");
  return { Authorization: `token ${decryptConfigTokens(config as Config).giteaConfig.token}` };
}

export async function getGiteaRepoInfo({ config, owner, repoName }: {
  config: Partial<Config>; owner: string; repoName: string;
}): Promise<GiteaRepoInfo | null> {
  try {
    return (await httpGet<GiteaRepoInfo>(`${config.giteaConfig?.url}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, headers(config))).data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

export async function findGiteaMirrorBySource({ config, repository }: {
  config: Partial<Config>; repository: Repository;
}): Promise<GiteaRepoInfo | null> {
  const matches = (await listHFDestinationRepositories(config)).filter(repo => isHFDestinationRepository(repo, repository));
  if (matches.length > 1) throw new Error("Multiple destination repositories have the same HF source marker");
  return matches[0] ?? null;
}

export async function getOrCreateGiteaOrg({ config, orgName }: { config: Partial<Config>; orgName: string }): Promise<number> {
  const url = `${config.giteaConfig?.url}/api/v1`;
  const auth = headers(config);
  try { return (await httpGet<{ id: number }>(`${url}/orgs/${encodeURIComponent(orgName)}`, auth)).data.id; }
  catch (error) { if (!(error instanceof HttpError) || error.status !== 404) throw error; }
  if (config.giteaConfig?.createOrg === false) throw new Error(`Destination organization ${orgName} does not exist`);
  const visibility = config.giteaConfig?.visibility ?? "private";
  try {
    return (await httpPost<{ id: number }>(`${url}/orgs`, { username: orgName, visibility: visibility === "default" ? undefined : visibility }, auth)).data.id;
  } catch (error) {
    try { return (await httpGet<{ id: number }>(`${url}/orgs/${encodeURIComponent(orgName)}`, auth)).data.id; }
    catch { throw error; }
  }
}

export async function transferGiteaRepo({ config, owner, repoName, newOwner }: {
  config: Partial<Config>; owner: string; repoName: string; newOwner: string;
}): Promise<GiteaTransferResult> {
  const response = await httpPost<GiteaRepoInfo>(
    `${config.giteaConfig?.url}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/transfer`,
    { new_owner: newOwner }, headers(config));
  const repo = response.data;
  const landedOwner = typeof repo.owner === "string" ? repo.owner : repo.owner?.login ?? "";
  const pending = !!repo.repo_transfer || (landedOwner ? landedOwner.toLowerCase() !== newOwner.toLowerCase() : response.status === 201);
  return { pending, repo };
}
