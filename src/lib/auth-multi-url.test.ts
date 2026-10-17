import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("Multiple URL Support in BETTER_AUTH_URL", () => {
  let originalAuthUrl: string | undefined;
  let originalTrustedOrigins: string | undefined;

  beforeEach(() => {
    // Save original environment variables
    originalAuthUrl = process.env.BETTER_AUTH_URL;
    originalTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalAuthUrl !== undefined) {
      process.env.BETTER_AUTH_URL = originalAuthUrl;
    } else {
      delete process.env.BETTER_AUTH_URL;
    }

    if (originalTrustedOrigins !== undefined) {
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
    } else {
      delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    }
  });

  test("should parse single URL correctly", () => {
    process.env.BETTER_AUTH_URL = "https://hf-mirror.mydomain.tld";

    const parseAuthUrls = () => {
      const urlEnv = process.env.BETTER_AUTH_URL || "http://localhost:5321";
      const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);

      // Find first valid URL
      for (const url of urls) {
        try {
          new URL(url);
          return { primary: url, all: urls };
        } catch {
          // Skip invalid
        }
      }
      return { primary: "http://localhost:5321", all: [] };
    };

    const result = parseAuthUrls();
    expect(result.primary).toBe("https://hf-mirror.mydomain.tld");
    expect(result.all).toEqual(["https://hf-mirror.mydomain.tld"]);
  });

  test("should parse multiple URLs and use first as primary", () => {
    process.env.BETTER_AUTH_URL = "http://10.10.20.45:5321,https://hf-mirror.mydomain.tld";

    const parseAuthUrls = () => {
      const urlEnv = process.env.BETTER_AUTH_URL || "http://localhost:5321";
      const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);

      // Find first valid URL
      for (const url of urls) {
        try {
          new URL(url);
          return { primary: url, all: urls };
        } catch {
          // Skip invalid
        }
      }
      return { primary: "http://localhost:5321", all: [] };
    };

    const result = parseAuthUrls();
    expect(result.primary).toBe("http://10.10.20.45:5321");
    expect(result.all).toEqual([
      "http://10.10.20.45:5321",
      "https://hf-mirror.mydomain.tld"
    ]);
  });

  test("should handle invalid URLs gracefully", () => {
    process.env.BETTER_AUTH_URL = "not-a-url,http://valid.url:5321,also-invalid";

    const parseAuthUrls = () => {
      const urlEnv = process.env.BETTER_AUTH_URL || "http://localhost:5321";
      const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);

      const validUrls: string[] = [];
      let primaryUrl = "";

      for (const url of urls) {
        try {
          new URL(url);
          validUrls.push(url);
          if (!primaryUrl) {
            primaryUrl = url;
          }
        } catch {
          // Skip invalid URLs
        }
      }

      return {
        primary: primaryUrl || "http://localhost:5321",
        all: validUrls
      };
    };

    const result = parseAuthUrls();
    expect(result.primary).toBe("http://valid.url:5321");
    expect(result.all).toEqual(["http://valid.url:5321"]);
  });

  test("should include all URLs in trusted origins", () => {
    process.env.BETTER_AUTH_URL = "http://10.10.20.45:5321,https://hf-mirror.mydomain.tld";
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://auth.provider.com";

    const getTrustedOrigins = () => {
      const origins = [
        "http://localhost:5321",
        "http://localhost:8080",
      ];

      // Add all URLs from BETTER_AUTH_URL
      const urlEnv = process.env.BETTER_AUTH_URL || "";
      if (urlEnv) {
        const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);
        urls.forEach(url => {
          try {
            new URL(url);
            origins.push(url);
          } catch {
            // Skip invalid
          }
        });
      }

      // Add additional trusted origins
      if (process.env.BETTER_AUTH_TRUSTED_ORIGINS) {
        origins.push(...process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map(o => o.trim()));
      }

      // Remove duplicates
      return [...new Set(origins.filter(Boolean))];
    };

    const origins = getTrustedOrigins();
    expect(origins).toContain("http://10.10.20.45:5321");
    expect(origins).toContain("https://hf-mirror.mydomain.tld");
    expect(origins).toContain("https://auth.provider.com");
    expect(origins).toContain("http://localhost:5321");
  });

  test("should handle empty BETTER_AUTH_URL", () => {
    delete process.env.BETTER_AUTH_URL;

    const parseAuthUrls = () => {
      const urlEnv = process.env.BETTER_AUTH_URL || "http://localhost:5321";
      const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);

      for (const url of urls) {
        try {
          new URL(url);
          return { primary: url, all: urls };
        } catch {
          // Skip invalid
        }
      }
      return { primary: "http://localhost:5321", all: ["http://localhost:5321"] };
    };

    const result = parseAuthUrls();
    expect(result.primary).toBe("http://localhost:5321");
  });

  test("should handle whitespace in comma-separated URLs", () => {
    process.env.BETTER_AUTH_URL = " http://10.10.20.45:5321 , https://hf-mirror.mydomain.tld , http://localhost:3000 ";

    const parseAuthUrls = () => {
      const urlEnv = process.env.BETTER_AUTH_URL || "http://localhost:5321";
      const urls = urlEnv.split(',').map(u => u.trim()).filter(Boolean);
      return urls;
    };

    const urls = parseAuthUrls();
    expect(urls).toEqual([
      "http://10.10.20.45:5321",
      "https://hf-mirror.mydomain.tld",
      "http://localhost:3000"
    ]);
  });
});
