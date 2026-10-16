import type { PushDestinationKind } from "@/lib/destination-kinds";
import { GiteaPushTarget } from "./gitea";
import type { PushTarget, PushTargetConnection } from "./types";
export * from "./types";
export { GiteaPushTarget } from "./gitea";
export { isTargetNotFound } from "./http";
export function createPushTarget(kind: PushDestinationKind, connection: PushTargetConnection): PushTarget {
  if (kind !== "gitea" && kind !== "forgejo") throw new Error("HF-mirror requires a Gitea or Forgejo destination");
  return new GiteaPushTarget(connection);
}
