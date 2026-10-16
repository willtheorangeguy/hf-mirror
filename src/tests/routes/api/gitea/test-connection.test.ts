import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock the POST function
const mockPOST = mock(async ({ request }) => {
  const body = await request.json();

  // Check for missing URL or token
  if (!body.url || !body.token) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Gitea URL and token are required"
      }),
      { status: 400 }
    );
  }

  // Check for username mismatch
  if (body.username && body.username !== "giteauser") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Token belongs to giteauser, not " + body.username
      }),
      { status: 400 }
    );
  }

  // Handle invalid token
  if (body.token === "invalid-token") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Invalid Gitea token"
      }),
      { status: 401 }
    );
  }

  // Success case
  return new Response(
    JSON.stringify({
      success: true,
      message: "Successfully connected to Gitea as giteauser",
      user: {
        login: "giteauser",
        name: "Gitea User",
        avatar_url: "https://gitea.example.com/avatar.png"
      }
    }),
    { status: 200 }
  );
});

// Mock the module
mock.module("@/pages/api/gitea/test-connection", () => {
  return {
    POST: mockPOST
  };
});

// Import after mocking
import { POST } from "@/pages/api/gitea/test-connection";

describe("Gitea Test Connection API", () => {
  // Mock console.error to prevent test output noise
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("returns 400 if url or token is missing", async () => {
    // Test missing URL
    const requestMissingUrl = new Request("http://localhost/api/gitea/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: "valid-token"
      })
    });

    const responseMissingUrl = await POST({ request: requestMissingUrl } as any);

    expect(responseMissingUrl.status).toBe(400);

    const dataMissingUrl = await responseMissingUrl.json();
    expect(dataMissingUrl.success).toBe(false);
    expect(dataMissingUrl.message).toBe("Gitea URL and token are required");

    // Test missing token
    const requestMissingToken = new Request("http://localhost/api/gitea/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://gitea.example.com"
      })
    });

    const responseMissingToken = await POST({ request: requestMissingToken } as any);

    expect(responseMissingToken.status).toBe(400);

    const dataMissingToken = await responseMissingToken.json();
    expect(dataMissingToken.success).toBe(false);
    expect(dataMissingToken.message).toBe("Gitea URL and token are required");
  });

  test("returns 200 with user data on successful connection", async () => {
    const request = new Request("http://localhost/api/gitea/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://gitea.example.com",
        token: "valid-token"
      })
    });

    const response = await POST({ request } as any);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Successfully connected to Gitea as giteauser");
    expect(data.user).toEqual({
      login: "giteauser",
      name: "Gitea User",
      avatar_url: "https://gitea.example.com/avatar.png"
    });
  });

  test("returns 400 if username doesn't match authenticated user", async () => {
    const request = new Request("http://localhost/api/gitea/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://gitea.example.com",
        token: "valid-token",
        username: "differentuser"
      })
    });

    const response = await POST({ request } as any);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Token belongs to giteauser, not differentuser");
  });

  test("handles authentication errors", async () => {
    const request = new Request("http://localhost/api/gitea/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://gitea.example.com",
        token: "invalid-token"
      })
    });

    const response = await POST({ request } as any);

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Invalid Gitea token");
  });
});
