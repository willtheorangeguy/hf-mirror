import type { Config } from "@/lib/db/schema";
import type { GitRepo } from "@/types/Repository";
import { orgForkSkipDecision } from "@/lib/utils/mirror-overrides";
import type { ListRepositoriesOptions } from "./types";

export function filterSourceRepositories(
  repos: GitRepo[],
  {
    config,
    options = {},
    username,
  }: {
    config: Partial<Config>;
    options?: ListRepositoriesOptions;
    username: string;
  }
): GitRepo[] {
  const includeCollab =
    options.includeCollaboratorReposOverride ??
    config.sourceConfig?.includeCollaboratorRepos ??
    true;
  const forkSkipFor = orgForkSkipDecision(options.orgForkOverrides, config);
  const skipPersonalRepos = config.sourceConfig?.skipPersonalRepos ?? false;
  const includeOrgs = options.includeAllOrgsOverride
    ? []
    : config.sourceConfig?.includeOrganizations ?? [];
  const allowedOrgs = new Set(
    includeOrgs.map((org) => org.trim().toLowerCase()).filter(Boolean)
  );
  const me = username.trim().toLowerCase();

  return repos.filter((repo) => {
    const ownerKey = repo.owner.trim().toLowerCase();
    const orgKey = (repo.organization ?? "").trim().toLowerCase();
    const isOrgRepo = orgKey.length > 0;
    const isOwnRepo = !isOrgRepo && me.length > 0 && ownerKey === me;

    if (forkSkipFor(repo.organization) && repo.isForked) return false;

    if (skipPersonalRepos && isOwnRepo) return false;
    if (!includeCollab && !isOrgRepo && !isOwnRepo) return false;
    if (allowedOrgs.size > 0 && isOrgRepo && !allowedOrgs.has(orgKey)) return false;

    return true;
  });
}
