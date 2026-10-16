import type { Config, Repository } from "./db/schema";
import { pushMirrorRepository } from "./push-engine/mirror";

interface MirrorRepositoryArgs { config: Partial<Config>; repository: Repository }
export function mirrorRepositoryToDestination(args: MirrorRepositoryArgs): Promise<unknown> {
  return pushMirrorRepository({ ...args, mode: "mirror" });
}
export function syncRepositoryOnDestination(args: MirrorRepositoryArgs): Promise<unknown> {
  return pushMirrorRepository({ ...args, mode: "sync" });
}
