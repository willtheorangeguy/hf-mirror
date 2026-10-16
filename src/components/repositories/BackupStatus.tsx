import type { Repository } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";

export function BackupStatus({ repository }: { repository: Pick<Repository, "metadata"> }) {
  let state: { git?: string; largeFiles?: string; metadata?: string; progress?: string } | undefined;
  try { state = repository.metadata ? JSON.parse(repository.metadata).hf : undefined; } catch { return null; }
  if (!state) return null;
  const complete = state.git === "complete" && state.largeFiles === "complete" && ["complete", "excluded"].includes(state.metadata ?? "");
  const label = complete ? "Full backup" : state.git === "running" || state.largeFiles === "running" ? "In progress" : state.largeFiles === "excluded" && state.git === "complete" ? "Git only" : "Incomplete";
  return <Badge variant="outline" className="text-[10px]" title={`Git: ${state.git ?? "pending"} · Large files: ${state.largeFiles ?? "pending"} · Metadata: ${state.metadata ?? "pending"}${state.progress ? ` · ${state.progress}` : ""}`}>{label}</Badge>;
}
