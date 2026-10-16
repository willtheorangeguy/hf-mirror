import { repositorySchema } from "@/lib/db/schema";
import type { APIRoute } from "astro";

import { db, configs, repositories } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { mirrorRepositoryToDestination } from "@/lib/mirror-dispatch";

import type { RetryRepoRequest } from "@/types/retry";
import { processWithRetry } from "@/lib/utils/concurrency";

import { createSecureErrorResponse } from "@/lib/utils";
import { requireAuthenticatedUserId } from "@/lib/auth-guards";

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const authResult = await requireAuthenticatedUserId({ request, locals });
    if ("response" in authResult) return authResult.response;
    const userId = authResult.userId;

    const body: RetryRepoRequest = await request.json();
    const { repositoryIds } = body;

    if (!repositoryIds || !Array.isArray(repositoryIds)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "repositoryIds are required.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (repositoryIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No repository IDs provided.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch user config — prefer active and most-recently-updated to avoid picking
    // a stale inactive stub when multiple rows exist (see issue #271).
    const configResult = await db
      .select()
      .from(configs)
      .where(eq(configs.userId, userId))
      .orderBy(sql`${configs.isActive} DESC`, sql`${configs.updatedAt} DESC`)
      .limit(1);

    const config = configResult[0];

    if (!config || !config.giteaConfig?.token) {
      return new Response(
        JSON.stringify({ error: "Missing destination configuration." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch repositories
    const repos = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.userId, userId),
          inArray(repositories.id, repositoryIds)
        )
      );

    if (!repos.length) {
      return new Response(
        JSON.stringify({ error: "No repositories found for the given IDs." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    setTimeout(async () => {
      await processWithRetry(repos, async (repo) => {
        await mirrorRepositoryToDestination({ config, repository: repositorySchema.parse({ ...repo, mirroredLocation: repo.mirroredLocation ?? "" }) });
        return repo;
      }, { concurrencyLimit: 3, maxRetries: 2, retryDelay: 2000 });
    }, 0);
    return Response.json({ success: true, message: "Retry job started", repositories: repos });
  } catch (error) {
    return createSecureErrorResponse(error, "repository retry", 500);
  }
};
