import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "@/lib/db/schema";
import type { GitRepo, HFRepoType } from "@/types/Repository";
import type { GitOrg } from "@/types/organizations";
import { safeFetch } from "@/lib/utils/outbound-url";
import { SourceApiError, toDate, withQuery } from "./http";
import { filterSourceRepositories } from "./filters";
import type { SourceConnection, SourceProvider, SourceRepositoryPath, ListRepositoriesOptions } from "./types";

export const HF_REPO_TYPES: HFRepoType[] = ["model", "dataset", "space"];
export const hfApiPath = (type: HFRepoType, id: string) => `/api/${type}s/${id.split("/").map(encodeURIComponent).join("/")}`;
export const hfRepoPath = (type: HFRepoType, id: string) => `${type === "model" ? "" : `${type}s/`}${id}`;

export interface HFRepository {
  id: string;
  private?: boolean;
  gated?: boolean | string;
  disabled?: boolean;
  sha?: string;
  createdAt?: string;
  lastModified?: string;
  description?: string;
  tags?: string[];
  cardData?: Record<string, unknown>;
  usedStorage?: number;
  siblings?: { rfilename: string; lfs?: { oid: string; size: number } }[];
}

export function mapHFRepository(repo: HFRepository, type: HFRepoType, connection: SourceConnection, organization = false): GitRepo {
  const [owner, name] = repo.id.split("/");
  if (!owner || !name || repo.id.split("/").length !== 2) throw new Error(`Invalid HF repository id: ${repo.id}`);
  const isGated = !!repo.gated && repo.gated !== "false";
  const url = `${connection.url}/${hfRepoPath(type, repo.id)}`;
  return {
    repoType: type, isGated, name, owner, fullName: repo.id, url, cloneUrl: `${url}.git`,
    organization: organization ? owner : undefined,
    sourceProvider: "huggingface", sourceUrl: connection.url,
    isPrivate: !!repo.private, visibility: repo.private ? "private" : "public",
    isForked: false, hasIssues: true, isStarred: false, isArchived: false,
    isDisabled: !!repo.disabled, hasLFS: (repo.siblings ?? []).some(f => !!f.lfs), hasSubmodules: false,
    size: Math.ceil((repo.usedStorage ?? 0) / 1024), defaultBranch: "main",
    description: repo.description ?? (typeof repo.cardData?.description === "string" ? repo.cardData.description : null),
    status: "imported", importedAt: new Date(), createdAt: toDate(repo.createdAt), updatedAt: toDate(repo.lastModified),
  };
}

export function resolveHFRepositoryPath(segments: string[]): SourceRepositoryPath | null {
  const parts = [...segments];
  let repoType: HFRepoType = "model";
  if (parts[0] === "datasets" || parts[0] === "spaces" || parts[0] === "models") {
    repoType = parts.shift()!.slice(0, -1) as HFRepoType;
  }
  const [owner, rawName] = parts;
  const repo = rawName?.replace(/\.git$/i, "");
  if (!owner || !repo || ![owner, repo].every(p => /^[\w.-]+$/.test(p) && p !== "." && p !== "..")) return null;
  return { owner, repo, repoType };
}

/** HF returns 404 for both inaccessible and absent private repos. Never infer deletion from it. */
export class HuggingFaceSourceProvider implements SourceProvider {
  readonly kind = "huggingface" as const;
  constructor(readonly connection: SourceConnection, private readonly signal?: AbortSignal, private readonly log?: (message: string) => void) {}

  async request<T>(path: string): Promise<{ data: T; response: Response }> {
    const url = new URL(path, `${this.connection.url}/`);
    if (url.origin !== new URL(this.connection.url).origin) throw new Error("HF pagination crossed source origin");
    for (let attempt = 0; ; attempt++) {
      const response = await safeFetch(url.toString(), {
        headers: { Accept: "application/json", ...(this.connection.token ? { Authorization: `Bearer ${this.connection.token}` } : {}) },
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(this.signal ? [this.signal] : [])]),
      });
      if (response.ok) return { data: await response.json() as T, response };
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retry = response.headers.get("retry-after");
        const reset = response.headers.get("ratelimit")?.match(/\bt=(\d+)/)?.[1];
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : reset ? Number(reset) : 2 ** attempt;
        if (seconds > 600) throw new SourceApiError("HF rate limit reset exceeds ten minutes; retry later", response.status, url.toString());
        (this.log ?? console.info)(`[HF] Waiting ${seconds}s after HTTP ${response.status} (${attempt + 1}/3)`);
        await response.body?.cancel();
        await delay(Math.max(1, seconds) * 1000, undefined, { signal: this.signal });
        continue;
      }
      throw new SourceApiError(`HF request failed (${response.status}); check token access for private/gated repositories`, response.status, url.toString());
    }
  }

  async paginate<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = path;
    while (next) {
      if (seen.has(next) || seen.size >= 10_000) throw new Error("HF pagination did not finish; discovery is incomplete");
      seen.add(next);
      const { data, response }: { data: T[]; response: Response } = await this.request<T[]>(next);
      if (!Array.isArray(data)) throw new Error("Unexpected HF paginated response");
      items.push(...data);
      next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return items;
  }

  async testConnection() {
    const { data } = await this.request<{ name: string; fullname?: string; avatarUrl?: string }>("/api/whoami-v2");
    if (!data.name) throw new Error("HF did not return a token owner");
    return { login: data.name, name: data.fullname, avatarUrl: data.avatarUrl };
  }

  async getOrganization(name: string): Promise<GitOrg | null> {
    try {
      const { data } = await this.request<{ name: string; avatarUrl?: string }>(`/api/organizations/${encodeURIComponent(name)}/overview`);
      return { name: data.name || name, avatarUrl: data.avatarUrl || "", membershipRole: "member", isIncluded: false, status: "imported", repositoryCount: 0, createdAt: new Date(), updatedAt: new Date() };
    } catch (error) {
      if (error instanceof SourceApiError && error.status === 404) return null;
      throw error;
    }
  }

  async listOrganizations(config: Partial<Config>, skipOrgNames = new Set<string>()) {
    const names = new Set(config.sourceConfig?.includeOrganizations ?? []);
    if (!this.connection.token && this.connection.username) {
      const organization = await this.getOrganization(this.connection.username);
      if (organization) names.add(organization.name);
    }
    if (this.connection.token) {
      const { data } = await this.request<{ orgs?: { name: string }[] }>("/api/whoami-v2");
      for (const org of data.orgs ?? []) names.add(org.name);
    }
    const organizations: GitOrg[] = [];
    const failedOrgs: { name: string; avatarUrl: string; reason: string }[] = [];
    for (const name of names) {
      if (skipOrgNames.has(name.toLowerCase())) continue;
      try {
        const org = await this.getOrganization(name);
        if (!org) throw new Error("Organization unavailable");
        organizations.push(org);
      } catch (error) { failedOrgs.push({ name, avatarUrl: "", reason: String(error) }); }
    }
    return { organizations, failedOrgs };
  }

  private async byOwner(owner: string, types = HF_REPO_TYPES, organization = false): Promise<GitRepo[]> {
    const result: GitRepo[] = [];
    for (const type of types) {
      const entries = await this.paginate<HFRepository>(withQuery(`/api/${type}s`, { author: owner, limit: 100, full: true }));
      result.push(...entries.map(entry => mapHFRepository(entry, type, this.connection, organization)));
    }
    return result;
  }

  async listRepositories(config: Partial<Config>, options: ListRepositoriesOptions = {}) {
    const types = config.sourceConfig?.repoTypes ?? HF_REPO_TYPES;
    const repos = this.connection.username && !config.sourceConfig?.skipPersonalRepos
      ? await this.byOwner(this.connection.username, types, config.sourceConfig?.type === "organization") : [];
    const { organizations, failedOrgs } = await this.listOrganizations(config);
    if (failedOrgs.length) throw new Error(`HF organization discovery incomplete: ${failedOrgs.map(o => o.name).join(", ")}`);
    for (const org of organizations) repos.push(...await this.byOwner(org.name, types, true));
    for (const slug of config.sourceConfig?.collections ?? []) {
      const collection = await this.getCollection(slug);
      for (const item of collection.items ?? []) {
        if (!HF_REPO_TYPES.includes(item.type as HFRepoType)) { console.info(`[HF] Skipping collection item type ${item.type}`); continue; }
        if (!types.includes(item.type as HFRepoType)) continue;
        const [owner, name] = item.id.split("/");
        repos.push(await this.getRepository(owner, name, item.type as HFRepoType));
      }
    }
    const unique = [...new Map(repos.map(r => [`${r.repoType}:${r.fullName}`, r])).values()];
    return filterSourceRepositories(unique, { config, options, username: this.connection.username }).filter(r =>
      (r.isPrivate ? config.sourceConfig?.includePrivate !== false : config.sourceConfig?.includePublic !== false));
  }

  async listOrganizationRepositories(name: string, repoTypes = HF_REPO_TYPES) { return this.byOwner(name, repoTypes, true); }

  async getRepository(owner: string, name: string, repoType: HFRepoType = "model"): Promise<GitRepo> {
    const { data } = await this.request<HFRepository>(`${hfApiPath(repoType, `${owner}/${name}`)}?blobs=true`);
    return mapHFRepository(data, repoType, this.connection, !!await this.getOrganization(owner));
  }

  async listStarredRepositories(config: Partial<Config>): Promise<GitRepo[]> {
    const types = config.sourceConfig?.repoTypes ?? HF_REPO_TYPES;
    const likes = await this.paginate<{ repo: { name: string; type: HFRepoType } }>(`/api/users/${encodeURIComponent(this.connection.username)}/likes`);
    const repos: GitRepo[] = [];
    for (const { repo } of likes) {
      if (!types.includes(repo.type)) continue;
      const [owner, name] = repo.name.split("/");
      repos.push({ ...await this.getRepository(owner, name, repo.type), isStarred: true });
    }
    return repos;
  }

  async isRepositoryStarred(owner: string, name: string, repoType: HFRepoType = "model") {
    const likes = await this.paginate<{ repo: { name: string; type: HFRepoType } }>(`/api/users/${encodeURIComponent(this.connection.username)}/likes`);
    return likes.some(like => like.repo.name === `${owner}/${name}` && like.repo.type === repoType);
  }

  async getCollection(slug: string) {
    return (await this.request<{ slug: string; title?: string; items?: { id: string; type: string }[] }>(`/api/collections/${slug.split("/").map(encodeURIComponent).join("/")}`)).data;
  }

  resolveRepositoryPath(segments: string[]) { return resolveHFRepositoryPath(segments); }
}
