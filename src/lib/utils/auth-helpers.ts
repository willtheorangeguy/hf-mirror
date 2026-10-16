import type { APIContext } from "astro";
import { auth } from "@/lib/auth";

/**
 * Get authenticated user from request
 * @param request - The request object from Astro API route
 * @returns The authenticated user or null if not authenticated
 */
export async function getAuthenticatedUser(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    return session ? session.user : null;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

/**
 * Require authentication for API routes
 * Returns an error response if user is not authenticated
 * @param context - The API context from Astro
 * @returns Object with user if authenticated, or error response if not
 */
export async function requireAuth(context: APIContext) {
  const user = await getAuthenticatedUser(context.request);

  if (!user) {
    return {
      user: null,
      response: new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized - Please log in",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  return { user, response: null };
}

/**
 * Get user ID from authenticated session
 * @param request - The request object from Astro API route
 * @returns The user ID or null if not authenticated
 */
export async function getAuthenticatedUserId(request: Request): Promise<string | null> {
  const user = await getAuthenticatedUser(request);
  return user?.id || null;
}
