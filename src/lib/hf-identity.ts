import { createHash } from "node:crypto";

export interface HFIdentity { sourceUrl?: string | null; repoType?: string; fullName: string }
export function hfIdentity(repository: HFIdentity) { return `${repository.sourceUrl}|${repository.repoType}|${repository.fullName}`; }
export function hfMarker(repository: HFIdentity) { return `[HF-mirror:${createHash("sha256").update(hfIdentity(repository)).digest("hex")}]`; }
export function isHFDestinationRepository(candidate: unknown, repository: HFIdentity): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  const record = candidate as { description?: string; mirror?: boolean };
  return !record.mirror && typeof record.description === "string" && record.description.startsWith(hfMarker(repository));
}
