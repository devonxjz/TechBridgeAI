import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("production delivery configuration", () => {
  it("keeps secrets out of the Docker build context", () => {
    const dockerignore = read(".dockerignore");
    expect(dockerignore).toMatch(/^\.env\*$/m);
    expect(dockerignore).toMatch(/^\.git$/m);
    expect(dockerignore).toMatch(/^node_modules$/m);
  });

  it("runs database cleanup even when integration tests fail", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("supabase stop --no-backup");
  });

  it("publishes an immutable image rather than relying only on latest", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain("github.event.workflow_run.head_sha");
    expect(workflow).toMatch(/tags:[\s\S]*head_sha/);
  });
});
