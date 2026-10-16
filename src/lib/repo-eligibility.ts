import type { GitRepo } from "@/types/Repository";

export function isMirrorableSourceRepository(repo: Pick<GitRepo, "isDisabled">): boolean {
  return repo.isDisabled !== true;
}
