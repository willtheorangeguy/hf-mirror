import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, repositories } from "@/lib/db";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";
import { resolveDataDir } from "@/lib/push-engine/paths";

export const GET: APIRoute = async ({ request, locals, params }) => {
  const auth = await requireAuthenticatedUserId({ request, locals });
  if ("response" in auth) return auth.response;
  const [repository] = await db.select().from(repositories).where(and(eq(repositories.id, params.id ?? ""), eq(repositories.userId, auth.userId))).limit(1);
  if (!repository) return new Response("Repository not found", { status: 404 });
  const directory = path.join(resolveDataDir(), "archives", repository.id);
  try {
    const [metadata, transfer] = await Promise.all([readFile(path.join(directory, "latest.json"), "utf8"), readFile(path.join(directory, "transfer.json"), "utf8")]);
    return new Response(JSON.stringify({ transfer: JSON.parse(transfer), metadata: JSON.parse(metadata) }, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="hf-mirror-archive.json"', "Cache-Control": "no-store" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("No completed archive available", { status: 404 });
    return new Response("Archive could not be read", { status: 500 });
  }
};
