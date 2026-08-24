// ═══════════════════════════════════════════════════════
// SSRF-Safe Direct Scraper Adapter
// ═══════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import type dns from "node:dns";
import { ScrapeError, type ScraperAdapter, type ScrapedContent } from "./types";
import { resolvePublicTarget, type ResolvedTarget } from "./url-safety";

export interface DirectScraperLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  ca?: string | Buffer | Array<string | Buffer>;
}

type SingleRequestResult =
  | { type: "redirect"; nextUrl: string }
  | { type: "content"; content: ScrapedContent };

export class SafeDirectScraperAdapter implements ScraperAdapter {
  constructor(
    private readonly limits: DirectScraperLimits = {
      timeoutMs: 8_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    },
  ) {}

  cleanHtml(html: string): string {
    let result = "";
    let i = 0;
    const len = html.length;

    while (i < len) {
      if (html[i] === "<") {
        if (html.slice(i, i + 7).toLowerCase() === "<script") {
          const closeIdx = html.toLowerCase().indexOf("</script>", i + 7);
          if (closeIdx === -1) break;
          i = closeIdx + 9;
          continue;
        }
        if (html.slice(i, i + 6).toLowerCase() === "<style") {
          const closeIdx = html.toLowerCase().indexOf("</style>", i + 6);
          if (closeIdx === -1) break;
          i = closeIdx + 8;
          continue;
        }
        const closeTagIdx = html.indexOf(">", i + 1);
        if (closeTagIdx === -1) break;
        i = closeTagIdx + 1;
        result += " ";
        continue;
      }

      result += html[i];
      i++;
    }

    return result.replace(/\s+/g, " ").trim();
  }

  private buildRequestOptions(target: ResolvedTarget): https.RequestOptions {
    const isHttps = target.url.protocol === "https:";
    const port = target.url.port
      ? parseInt(target.url.port, 10)
      : isHttps
      ? 443
      : 80;

    const options: https.RequestOptions = {
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port,
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      headers: {
        Host: target.url.host,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html, text/plain;q=0.9",
        "Accept-Encoding": "identity",
        Connection: "close",
      },
      agent: false,
      lookup: (
        _hostname: string,
        optsOrCallback: unknown,
        maybeCallback?: unknown,
      ) => {
        const cb = (typeof optsOrCallback === "function" ? optsOrCallback : maybeCallback) as
          | ((err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void)
          | undefined;

        if (typeof cb === "function") {
          if (typeof optsOrCallback === "object" && (optsOrCallback as { all?: boolean })?.all) {
            cb(null, [{ address: target.address, family: target.family }]);
          } else {
            cb(null, target.address, target.family);
          }
        }
      },
    };

    if (isHttps) {
      options.servername = target.url.hostname;
      if (this.limits.ca) {
        options.ca = this.limits.ca;
      }
    }

    return options;
  }

  private validateHeaders(res: http.IncomingMessage): void {
    const contentEncoding = res.headers["content-encoding"];
    if (contentEncoding && contentEncoding !== "identity" && contentEncoding !== "") {
      throw new ScrapeError(`Unsupported Content-Encoding: ${contentEncoding}`, "direct", "blocked");
    }

    const headersDistinct = (res as { headersDistinct?: Record<string, string[]> }).headersDistinct;
    const dispositionValues = headersDistinct?.["content-disposition"] ||
      (res.headers["content-disposition"] ? [res.headers["content-disposition"]] : []);
    for (const disp of dispositionValues) {
      if (typeof disp === "string" && disp.toLowerCase().includes("attachment")) {
        throw new ScrapeError("Attachment Content-Disposition is forbidden", "direct", "blocked");
      }
    }

    // Fail closed on duplicate Content-Type headers
    const contentTypeValues = headersDistinct?.["content-type"] ||
      (res.headers["content-type"] ? [res.headers["content-type"]] : []);
    if (contentTypeValues.length > 1) {
      throw new ScrapeError("Duplicate Content-Type header", "direct", "blocked");
    }

    const rawContentType = (contentTypeValues[0] || "").toLowerCase();
    const isText =
      rawContentType.startsWith("text/html") ||
      rawContentType.startsWith("text/plain") ||
      rawContentType.startsWith("application/xhtml+xml");

    if (!isText) {
      throw new ScrapeError(
        `Non-text Content-Type: ${rawContentType || "unknown"}`,
        "direct",
        "blocked",
      );
    }

    // Fail closed on duplicate Content-Length headers
    const contentLengthValues = headersDistinct?.["content-length"] ||
      (res.headers["content-length"] ? [res.headers["content-length"]] : []);
    if (contentLengthValues.length > 1) {
      throw new ScrapeError("Duplicate Content-Length header", "direct", "blocked");
    }

    if (contentLengthValues.length > 0) {
      const declaredLen = parseInt(contentLengthValues[0], 10);
      if (isNaN(declaredLen) || declaredLen < 0) {
        throw new ScrapeError("Invalid Content-Length header", "direct", "blocked");
      }
      if (declaredLen > this.limits.maxResponseBytes) {
        throw new ScrapeError(
          `Content-Length ${declaredLen} exceeds limit ${this.limits.maxResponseBytes}`,
          "direct",
          "too_large",
        );
      }
    }
  }

  private readLimitedBody(
    res: http.IncomingMessage,
    onOverflow: (err: ScrapeError) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > this.limits.maxResponseBytes) {
          const err = new ScrapeError(
            `Response body exceeded limit of ${this.limits.maxResponseBytes} bytes`,
            "direct",
            "too_large",
          );
          onOverflow(err);
          reject(err);
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });

      res.on("error", (err) => {
        const scrapeErr = new ScrapeError(
          `Direct fetch stream error: ${err.message}`,
          "direct",
          "upstream_error",
        );
        onOverflow(scrapeErr);
        reject(scrapeErr);
      });
    });
  }

  private async performSingleRequest(
    target: ResolvedTarget,
    remainingTimeout: number,
  ): Promise<SingleRequestResult> {
    return new Promise<SingleRequestResult>((resolve, reject) => {
      let settled = false;
      let timeoutTimer: NodeJS.Timeout | null = null;
      let activeReq: http.ClientRequest | null = null;
      let activeRes: http.IncomingMessage | null = null;

      const settleOnce = (fn: () => void) => {
        if (!settled) {
          settled = true;
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          if (activeRes) {
            activeRes.destroy();
          }
          if (activeReq) {
            activeReq.destroy();
          }
          fn();
        }
      };

      timeoutTimer = setTimeout(() => {
        settleOnce(() => {
          reject(new ScrapeError("Direct fetch request timed out", "direct", "timeout"));
        });
      }, remainingTimeout);

      const isHttps = target.url.protocol === "https:";
      const transport = isHttps ? https : http;
      const options = this.buildRequestOptions(target);

      const req = transport.request(options, (res) => {
        activeRes = res;
        const statusCode = res.statusCode || 0;

        // Handle redirects
        if (
          statusCode === 301 ||
          statusCode === 302 ||
          statusCode === 303 ||
          statusCode === 307 ||
          statusCode === 308
        ) {
          const location = res.headers.location;
          if (!location) {
            settleOnce(() => {
              reject(new ScrapeError("Redirect missing Location header", "direct", "upstream_error"));
            });
            return;
          }

          let nextUrl: string;
          try {
            nextUrl = new URL(location, target.url).toString();
          } catch {
            settleOnce(() => {
              reject(new ScrapeError(`Invalid redirect URL: ${location}`, "direct", "invalid_target"));
            });
            return;
          }

          settleOnce(() => {
            resolve({ type: "redirect", nextUrl });
          });
          return;
        }

        if (statusCode === 429) {
          settleOnce(() => {
            reject(new ScrapeError("Direct fetch rate limited", "direct", "rate_limited"));
          });
          return;
        }

        if (statusCode < 200 || statusCode >= 400) {
          settleOnce(() => {
            reject(
              new ScrapeError(
                `Direct fetch upstream error: ${statusCode}`,
                "direct",
                "upstream_error",
              ),
            );
          });
          return;
        }

        try {
          this.validateHeaders(res);
        } catch (err) {
          settleOnce(() => reject(err));
          return;
        }

        this.readLimitedBody(res, (overflowErr) => {
          settleOnce(() => reject(overflowErr));
        })
          .then((fullHtml) => {
            const titleMatch = fullHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : "";
            const cleanText = this.cleanHtml(fullHtml);

            if (cleanText.length <= 50) {
              settleOnce(() => {
                reject(new ScrapeError("Direct fetch returned empty text", "direct", "empty"));
              });
              return;
            }

            settleOnce(() => {
              resolve({
                type: "content",
                content: {
                  url: target.url.toString(),
                  title,
                  text: cleanText.slice(0, 10000),
                  metadata: { provider: "direct" },
                },
              });
            });
          })
          .catch((err) => {
            settleOnce(() => reject(err));
          });
      });

      activeReq = req;

      req.on("error", (err: Error & { code?: string }) => {
        settleOnce(() => {
          if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
            reject(new ScrapeError(`Direct fetch connection error: ${err.message}`, "direct", "timeout"));
          } else if (
            err.code?.startsWith("HPE_") ||
            err.message?.toLowerCase().includes("parse error") ||
            err.message?.includes("Duplicate Content-Length")
          ) {
            reject(new ScrapeError(`Invalid or duplicate header: ${err.message}`, "direct", "blocked"));
          } else {
            reject(new ScrapeError(`Direct fetch request error: ${err.message}`, "direct", "upstream_error"));
          }
        });
      });

      req.end();
    });
  }

  async extract(initialUrl: string): Promise<ScrapedContent> {
    const deadlineAt = Date.now() + this.limits.timeoutMs;
    let currentUrl = initialUrl;
    let redirectCount = 0;

    while (true) {
      const remainingBeforeDns = deadlineAt - Date.now();
      if (remainingBeforeDns <= 0) {
        throw new ScrapeError("Direct fetch timed out", "direct", "timeout");
      }

      const target = await resolvePublicTarget(currentUrl, deadlineAt);

      const remainingBeforeReq = deadlineAt - Date.now();
      if (remainingBeforeReq <= 0) {
        throw new ScrapeError("Direct fetch timed out", "direct", "timeout");
      }

      const requestResult = await this.performSingleRequest(target, remainingBeforeReq);

      if (requestResult.type === "redirect") {
        if (redirectCount >= this.limits.maxRedirects) {
          throw new ScrapeError(
            `Max redirects (${this.limits.maxRedirects}) exceeded`,
            "direct",
            "blocked",
          );
        }
        redirectCount++;
        currentUrl = requestResult.nextUrl;
        continue;
      }

      return requestResult.content;
    }
  }
}
