import path from "node:path";

/** Resolve the database consistently for the app and operational commands. */
export function resolveDbPath(url = process.env.DATABASE_URL): string {
  const configured = url?.trim();
  if (!configured) return path.join(process.cwd(), "data", "hf-mirror.db");
  const raw = configured.startsWith("sqlite://")
    ? configured.slice("sqlite://".length)
    : configured.startsWith("file:")
      ? configured.slice("file:".length)
      : configured;
  return path.resolve(raw);
}
