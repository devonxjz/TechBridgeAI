import { describe, it, expect, vi } from "vitest";
import { createCrawlPolicy } from "@/modules/research/crawl-policy";

describe("Crawl Policy & Robots Parser", () => {
  it("allows paths when robots.txt permits the user agent", async () => {
    const robotsTxt = `
      User-agent: *
      Disallow: /admin/
      Disallow: /private/
      Allow: /news/
    `;

    const loadRobots = vi.fn().mockResolvedValue(robotsTxt);
    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 0,
      robotsCacheTtlMs: 86400000,
    });

    const allowedDecision = await policy.beforeFetch("https://example.com/news/article-1");
    expect(allowedDecision.robotsDecision).toBe("allowed");
    expect(allowedDecision.shouldExtract).toBe(true);

    const disallowedDecision = await policy.beforeFetch("https://example.com/admin/login");
    expect(disallowedDecision.robotsDecision).toBe("disallowed");
    expect(disallowedDecision.shouldExtract).toBe(false);
  });

  it("treats empty or 404 robots content as allowed", async () => {
    const loadRobots = vi.fn().mockResolvedValue("");
    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 0,
      robotsCacheTtlMs: 86400000,
    });

    const decision = await policy.beforeFetch("https://example.com/any-article");
    expect(decision.robotsDecision).toBe("allowed");
    expect(decision.shouldExtract).toBe(true);
  });

  it("treats robots load failure (timeout, network error) as unknown and shouldExtract=false", async () => {
    const loadRobots = vi.fn().mockRejectedValue(new Error("Connection timed out"));
    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 0,
      robotsCacheTtlMs: 86400000,
    });

    const decision = await policy.beforeFetch("https://example.com/any-article");
    expect(decision.robotsDecision).toBe("unknown");
    expect(decision.shouldExtract).toBe(false);
  });

  it("enforces per-domain interval throttling without blocking distinct domains", async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const loadRobots = vi.fn().mockResolvedValue("User-agent: *\nAllow: /");

    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 1000,
      robotsCacheTtlMs: 86400000,
      now,
    });

    // Domain A first request
    const d1 = await policy.beforeFetch("https://domain-a.com/article-1");
    expect(d1.shouldExtract).toBe(true);

    // Domain B immediate request does NOT wait for Domain A
    const d2 = await policy.beforeFetch("https://domain-b.com/article-1");
    expect(d2.shouldExtract).toBe(true);
  });

  it("caches robots.txt by origin within TTL", async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const loadRobots = vi.fn().mockResolvedValue("User-agent: *\nAllow: /");

    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 0,
      robotsCacheTtlMs: 60000,
      now,
    });

    await policy.beforeFetch("https://vnexpress.net/item-1");
    await policy.beforeFetch("https://vnexpress.net/item-2");
    expect(loadRobots).toHaveBeenCalledTimes(1);

    // Advance time past TTL
    currentTime += 70000;
    await policy.beforeFetch("https://vnexpress.net/item-3");
    expect(loadRobots).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately when aborted during throttle wait and cleans up", async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const loadRobots = vi.fn().mockResolvedValue("User-agent: *\nAllow: /");

    const policy = createCrawlPolicy(loadRobots, {
      userAgent: "PartnerIQBot",
      minDomainIntervalMs: 5000,
      robotsCacheTtlMs: 86400000,
      now,
    });

    await policy.beforeFetch("https://example.com/1");

    const controller = new AbortController();
    const waitPromise = policy.beforeFetch("https://example.com/2", controller.signal);
    controller.abort();

    await expect(waitPromise).rejects.toThrow("Execution aborted");
  });
});
