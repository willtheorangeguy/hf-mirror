import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { authenticateWithHeaders, isHeaderAuthEnabled } from "./auth-header";

export const headerAuthPlugin = () =>
  ({
    id: "header-auth",
    endpoints: {
      signInWithHeader: createAuthEndpoint(
        "/sign-in/header",
        { method: "POST" },
        async (ctx) => {
          if (!isHeaderAuthEnabled()) {
            throw new APIError("NOT_FOUND", {
              message: "Header authentication is not enabled",
            });
          }

          const headers = ctx.request?.headers ?? ctx.headers;
          if (!headers) {
            throw new APIError("BAD_REQUEST", {
              message: "Request headers unavailable",
            });
          }

          const user = await authenticateWithHeaders(headers);
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              message: "Header authentication failed",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }

          await setSessionCookie(ctx, { session, user });

          return ctx.json({
            token: session.token,
            user,
            session,
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
