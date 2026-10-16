export interface ReconcileOptions {
  dryRun: boolean;
  adoptUntracked: boolean;
  resetMissing: boolean;
  /** Repoint rows whose mirror was transferred to another owner (issue #400). */
  relocateMoved?: boolean;
}

export interface ReconcileReport {
  /** Mirrors of the configured source that have no database row. */
  untracked: Array<{
    location: string;
    originalUrl: string;
    sourcePath: string;
    isPrivate: boolean;
  }>;
  /** Rows that say mirrored, whose repository the destination no longer has. */
  missing: Array<{ id: string; fullName: string; location: string }>;
  /** Rows whose recorded mirror is gone while their source is mirrored under another owner. */
  moved: Array<{ id: string; fullName: string; from: string; to: string }>;
  /** Repositories on the destination this app does not own. */
  notManaged: Array<{ location: string; reason: string }>;
  /** Rows whose presence could not be confirmed because the check itself failed. */
  unverified: Array<{ fullName: string; location: string; error: string }>;
  healthyCount: number;
  /** Rows mirrored to another destination host; they are expected to be absent here. */
  elsewhereCount: number;
  scannedOwners: string[];
  skippedOwners: string[];
  totalOnDestination: number;
}

export interface ReconcileResult {
  dryRun: boolean;
  report: ReconcileReport;
  /** Null on a dry run. */
  applied: { adopted: number; reset: number; relocated: number; skipped: number } | null;
}

