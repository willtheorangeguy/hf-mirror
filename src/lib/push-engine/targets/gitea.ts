import { currentGitSignal } from "../git";
import type { EnsureRepositoryInput, PushTarget, PushTargetConnection, PushTargetRepository } from "./types";
import { PushTargetError } from "./types";
import { isTargetNotFound, targetFetch } from "./http";

interface GiteaRepo {
  name: string; owner: { login: string }; private: boolean; archived: boolean;
  clone_url: string; html_url: string; description?: string; mirror?: boolean;
}

/** Ordinary repositories managed by HF-mirror, not server-scheduled pull mirrors. */
export class GiteaPushTarget implements PushTarget {
  readonly kind = "gitea" as const;
  readonly baseUrl: string;
  constructor(
    private readonly connection: PushTargetConnection,
    private readonly createOrg = true,
    private readonly orgVisibility: "public" | "limited" | "private" | "default" = "private"
  ) {
    this.baseUrl = connection.url.replace(/\/+$/, "");
  }
  async api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return (await targetFetch<T>(`${this.baseUrl}/api/v1${path}`, {
      method, body, signal: currentGitSignal(), headers: { Authorization: `token ${this.connection.token}` },
    })).data;
  }
  pushCredentials() { return { username: this.connection.username, token: this.connection.token }; }
  async testConnection() {
    const user = await this.api<{ login: string }>("/user");
    return { login: user.login, label: "Gitea / Forgejo" };
  }
  private route(owner: string, name: string) { return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`; }
  private map(repo: GiteaRepo, created = false): PushTargetRepository {
    // Never trust a clone URL returned by a remote API with destination credentials.
    const pushUrl = `${this.baseUrl}/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}.git`;
    return { owner: repo.owner.login, name: repo.name, pushUrl, htmlUrl: repo.html_url,
      isPrivate: repo.private, archived: repo.archived, created };
  }
  async getRepository(owner: string, name: string) {
    try { return this.map(await this.api<GiteaRepo>(this.route(owner, name))); }
    catch (error) { if (isTargetNotFound(error)) return null; throw error; }
  }
  async ensureRepository(input: EnsureRepositoryInput): Promise<PushTargetRepository> {
    let existing: GiteaRepo | null = null;
    try { existing = await this.api<GiteaRepo>(this.route(input.owner, input.name)); }
    catch (error) { if (!isTargetNotFound(error)) throw error; }
    if (existing) {
      const marker = input.description?.match(/\[HF-mirror:[a-f0-9]+\]/)?.[0];
      if (!marker || !existing.description?.includes(marker) || existing.mirror) {
        throw new PushTargetError(`Destination collision at ${input.owner}/${input.name}; HF-mirror will only update repositories it created for this source.`);
      }
      if (input.isPrivate && !existing.private) {
        throw new PushTargetError("Private/gated source has a public destination. Make the destination private before retrying.");
      }
      return this.map(existing);
    }
    const personal = input.owner.toLowerCase() === this.connection.username.toLowerCase();
    if (!personal && this.createOrg) {
      try { await this.api(`/orgs/${encodeURIComponent(input.owner)}`); }
      catch (error) {
        if (!isTargetNotFound(error)) throw error;
        try { await this.api("/orgs", "POST", { username: input.owner, visibility: this.orgVisibility === "default" ? undefined : this.orgVisibility }); }
        catch (creationError) {
          // A concurrent repository may have created the organization.
          try { await this.api(`/orgs/${encodeURIComponent(input.owner)}`); }
          catch { throw creationError; }
        }
      }
    }
    const route = personal ? "/user/repos" : `/orgs/${encodeURIComponent(input.owner)}/repos`;
    try {
      const repo = await this.api<GiteaRepo>(route, "POST", {
        name: input.name, private: input.isPrivate, description: input.description,
        auto_init: false, has_issues: true, has_wiki: false,
      });
      return this.map(repo, true);
    } catch (error) {
      if (error instanceof PushTargetError && (error.status === 409 || error.status === 422)) {
        // Recheck ownership and privacy after a concurrent create.
        if (await this.getRepository(input.owner, input.name)) return this.ensureRepository(input);
        throw error;
      }
      throw error;
    }
  }
  async setDefaultBranch(owner: string, name: string, branch: string) { await this.api(this.route(owner, name), "PATCH", { default_branch: branch }); }
  async archiveRepository(owner: string, name: string) { await this.api(this.route(owner, name), "PATCH", { archived: true }); }
  async deleteRepository(owner: string, name: string) {
    try { await this.api(this.route(owner, name), "DELETE"); }
    catch (error) { if (!isTargetNotFound(error)) throw error; }
  }
}
