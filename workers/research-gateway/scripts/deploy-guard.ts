import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

if (/https:\/\/replace-[^"\s]+/.test(config) || config.includes("WORKER_SECRET_REQUIRED")) {
  throw new Error("Replace all Worker URL and secret placeholders before deploy");
}
