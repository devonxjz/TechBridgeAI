// ═══════════════════════════════════════════════════════
// SSRF-Safe Direct Scraper Adapter
// ═══════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import { ScrapeError, type ScraperAdapter, type ScrapedContent } from "./types";
import { resolvePublicTarget } from "./url-safety";

export interface DirectScraperLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
}

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
        // Check script tag
        if (html.slice(i, i + 7).toLowerCase() === "<script") {
          const closeIdx = html.toLowerCase().indexOf("</script>", i + 7);
          if (closeIdx === -1) {
            break;
          }
          i = closeIdx + 9;
          continue;
        }
        // Check style tag
        if (html.slice(i, i + 6).toLowerCase() === "<style") {
          const closeIdx = html.toLowerCase().indexOf("</style>", i + 6);
          if (closeIdx === -1) {
            break;
          }
          i = closeIdx + 8;
          continue;
        }
        // Other tag
        const closeTagIdx = html.indexOf(">", i + 1);
        if (closeTagIdx === -1) {
          break;
        }
        i = closeTagIdx + 1;
        result += " ";
        continue;
      }

      result += html[i];
      i++;
    }

    return result.replace(/\s+/g, " ").trim();
  }

  async extract(initialUrl: string): Promise<ScrapedContent> {
    const startTime = Date.now();
    let currentUrl = initialUrl;
    let redirectCount = 0;

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingTimeout = this.limits.timeoutMs - elapsed;

      if (remainingTimeout <= 0) {
        throw new ScrapeError("Direct fetch timed out", "direct", "timeout");
      }

      const target = await resolvePublicTarget(currentUrl);

      const requestResult = await new Promise<
        | { type: "redirect"; nextUrl: string }
        | { type: "content"; content: ScrapedContent }
      >((resolve, reject) => {
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
            optsOrCallback: any,
            maybeCallback?: any,
          ) => {
            const cb = typeof optsOrCallback === "function" ? optsOrCallback : maybeCallback;
            if (typeof cb === "function") {
              if (typeof optsOrCallback === "object" && optsOrCallback?.all) {
                cb(null, [{ address: target.address, family: target.family }]);
              } else {
                cb(null, target.address, target.family);
              }
            }
          },
        };

        if (isHttps) {
          options.servername = target.url.hostname;
        }

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
            if (redirectCount >= this.limits.maxRedirects) {
              settleOnce(() => {
                reject(
                  new ScrapeError(
                    `Max redirects (${this.limits.maxRedirects}) exceeded`,
                    "direct",
                    "blocked",
                  ),
                );
              });
              return;
            }

            const location = res.headers.location;
            if (!location) {
              settleOnce(() => {
                reject(
                  new ScrapeError("Redirect missing Location header", "direct", "upstream_error"),
                );
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

          // Validate headers
          const contentEncoding = res.headers["content-encoding"];
          if (contentEncoding && contentEncoding !== "identity" && contentEncoding !== "") {
            settleOnce(() => {
              reject(
                new ScrapeError(
                  `Unsupported Content-Encoding: ${contentEncoding}`,
                  "direct",
                  "blocked",
                ),
              );
            });
            return;
          }

          // Content-Disposition
          const dispositionValues = (res as any).headersDistinct?.["content-disposition"] ||
            (res.headers["content-disposition"] ? [res.headers["content-disposition"]] : []);
          for (const disp of dispositionValues) {
            if (typeof disp === "string" && disp.toLowerCase().includes("attachment")) {
              settleOnce(() => {
                reject(
                  new ScrapeError(
                    "Attachment Content-Disposition is forbidden",
                    "direct",
                    "blocked",
                  ),
                );
              });
              return;
            }
          }

          // Content-Type
          const contentTypeValues = (res as any).headersDistinct?.["content-type"] ||
            (res.headers["content-type"] ? [res.headers["content-type"]] : []);
          if (contentTypeValues.length > 1) {
            const first = contentTypeValues[0];
            if (contentTypeValues.some((ct: string) => ct !== first)) {
              settleOnce(() => {
                reject(
                  new ScrapeError("Conflicting Content-Type headers", "direct", "blocked"),
                );
              });
              return;
            }
          }

          const rawContentType = (contentTypeValues[0] || "").toLowerCase();
          const isText =
            rawContentType.startsWith("text/html") ||
            rawContentType.startsWith("text/plain") ||
            rawContentType.startsWith("application/xhtml+xml");

          if (!isText) {
            settleOnce(() => {
              reject(
                new ScrapeError(
                  `Non-text Content-Type: ${rawContentType || "unknown"}`,
                  "direct",
                  "blocked",
                ),
              );
            });
            return;
          }

          // Content-Length
          const contentLengthValues = (res as any).headersDistinct?.["content-length"] ||
            (res.headers["content-length"] ? [res.headers["content-length"]] : []);
          if (contentLengthValues.length > 1) {
            const first = contentLengthValues[0];
            if (contentLengthValues.some((cl: string) => cl !== first)) {
              settleOnce(() => {
                reject(
                  new ScrapeError("Conflicting Content-Length headers", "direct", "blocked"),
                );
              });
              return;
            }
          }

          if (contentLengthValues.length > 0) {
            const declaredLen = parseInt(contentLengthValues[0], 10);
            if (isNaN(declaredLen) || declaredLen < 0) {
              settleOnce(() => {
                reject(new ScrapeError("Invalid Content-Length header", "direct", "blocked"));
              });
              return;
            }
            if (declaredLen > this.limits.maxResponseBytes) {
              settleOnce(() => {
                reject(
                  new ScrapeError(
                    `Content-Length ${declaredLen} exceeds limit ${this.limits.maxResponseBytes}`,
                    "direct",
                    "too_large",
                  ),
                );
              });
              return;
            }
          }

          // Read body stream
          const chunks: Buffer[] = [];
          let totalBytes = 0;

          res.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > this.limits.maxResponseBytes) {
              settleOnce(() => {
                reject(
                  new ScrapeError(
                    `Response body exceeded limit of ${this.limits.maxResponseBytes} bytes`,
                    "direct",
                    "too_large",
                  ),
                );
              });
              return;
            }
            chunks.push(chunk);
          });

          res.on("end", () => {
            const fullHtml = Buffer.concat(chunks).toString("utf-8");
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
          });

          res.on("error", (err) => {
            settleOnce(() => {
              reject(
                new ScrapeError(
                  `Direct fetch stream error: ${err.message}`,
                  "direct",
                  "upstream_error",
                ),
              );
            });
          });
        });

        activeReq = req;

        req.on("error", (err: any) => {
          settleOnce(() => {
            if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
              reject(new ScrapeError(`Direct fetch connection error: ${err.message}`, "direct", "timeout"));
            } else {
              reject(new ScrapeError(`Direct fetch request error: ${err.message}`, "direct", "upstream_error"));
            }
          });
        });

        req.end();
      });

      if (requestResult.type === "redirect") {
        redirectCount++;
        currentUrl = requestResult.nextUrl;
        continue;
      }

      return requestResult.content;
    }
  }
}
