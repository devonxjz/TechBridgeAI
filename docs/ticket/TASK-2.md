# TASK-2 — TypeScript 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng toàn bộ compiler/type-check/build pipeline của PartnerIQ từ TypeScript 5.9.3 lên TypeScript 7.0.2 mà không phá Next.js, ESLint, Vitest hoặc production build.

**Architecture:** Next.js 16.3.2 tiếp tục build bằng project-local `tsc` CLI, nên TypeScript 7.0.2 đảm nhiệm type-check cho toàn repo. Vì TypeScript 7.0 chưa cung cấp JavaScript compiler API và `typescript-eslint@8.67.0` chỉ hỗ trợ TypeScript `<6.1.0`, repo giữ TypeScript 6.0.2 dưới package compatibility `typescript` cho ESLint và cài TypeScript 7 dưới alias `@typescript/native`, package này cung cấp binary `tsc`.

**Tech Stack:** TypeScript 7.0.2, TypeScript 6.0.2 compatibility API, Next.js 16.3.2, React 19.2.8, ESLint 9, eslint-config-next 16.3.2, Vitest 4.1.11, Node.js 20 CI.

**Spec:** `docs/plan/SPEC.md` — migration chỉ thay toolchain; domain model, runtime behavior, API contract và UI nằm ngoài scope.

## Global Constraints

- Pin TypeScript native compiler ở đúng `7.0.2`; không dùng `latest`, `next`, beta, RC hoặc nightly.
- Giữ Next.js và `eslint-config-next` ở `16.3.2` trong ticket này.
- Dùng compatibility package chính thức `@typescript/typescript6@6.0.2` cho tooling cần JavaScript compiler API.
- Không dùng `npm install --force`, `--legacy-peer-deps`, package override hoặc xóa peer warning bằng cách che lỗi.
- Không bật `typescript.ignoreBuildErrors` và không đặt `experimental.useTypeScriptCli: false` trong `next.config.ts`.
- Giữ `strict: true`, `moduleResolution: "bundler"`, `noEmit: true` và `skipLibCheck: true` như baseline hiện tại.
- Chỉ sửa source code khi TypeScript 7 tạo diagnostic cụ thể mà TypeScript 6 không tạo; mỗi diagnostic phải có test hoặc type-check command tái hiện.
- Không refactor business code, đổi runtime target, thêm abstraction hoặc nâng dependency không liên quan.
- Không sửa/xóa các thay đổi tài liệu đang có trong worktree ngoài file được liệt kê trong từng sprint.

---

## Current Baseline

| Item | Current | Target |
|---|---:|---:|
| Node local | `24.18.0` | Không đổi |
| Node CI | `20` | Không đổi |
| TypeScript compiler | `5.9.3` | `7.0.2` |
| TypeScript compatibility API | Không có | `6.0.2` |
| Next.js | `16.3.2` | Không đổi |
| eslint-config-next | `16.3.2` | Không đổi |
| typescript-eslint transitive | `8.67.0`, peer `<6.1.0` | Không đổi |
| Vitest | `4.1.11` | Không đổi |

## Final Dependency Shape

`package.json` phải có đúng cấu hình sau sau Sprint 2:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:legacy": "tsc6 --noEmit"
  },
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

Ý nghĩa binary sau cài đặt:

```text
npx tsc  --version  -> Version 7.0.2
npx tsc6 --version  -> Version 6.0.2
```

`typescript` alias tồn tại để ESLint import compiler API 6.0.2. Nó không thay đổi compiler chính: script `typecheck` và `next build` dùng binary `tsc` từ `@typescript/native`.

---

## Sprint 1 — Baseline & Compatibility Gate

**Mục tiêu:** Chứng minh repo sạch trước migration và khóa chính xác nguyên nhân cần dual-package setup.

**Thời lượng:** 30–45 phút.

**Files:**

- Update checkboxes only: `docs/ticket/TASK-2.md`
- No source or dependency changes

### S1.1 — Record baseline versions

- [x] Chạy:

```bash
node --version
npm --version
npx tsc --version
npm ls typescript next eslint-config-next vitest --depth=0
```

Expected:

```text
Node local: v24.18.0
TypeScript: Version 5.9.3
Next.js: 16.3.2
eslint-config-next: 16.3.2
Vitest: 4.1.11
```

### S1.2 — Confirm the compatibility constraint

- [x] Chạy:

```bash
npm explain typescript
npm view typescript-eslint@8.67.0 peerDependencies.typescript
npm view @typescript/typescript6 version
```

Expected:

```text
typescript-eslint peer range: >=4.8.4 <6.1.0
@typescript/typescript6 latest stable: 6.0.2
```

- [x] Xác nhận không thể thay trực tiếp root `typescript` bằng 7.0.2 mà vẫn tuyên bố dependency tree được hỗ trợ bởi ESLint.

### S1.3 — Run clean baseline gates

- [x] Chạy lần lượt:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected:

```text
Type-check: exit 0
Lint: exit 0
Vitest: all test files pass
Next.js production build: exit 0
```

- [x] Nếu baseline fail, dừng TASK-2 và xử lý lỗi hiện hữu riêng; không quy lỗi đó cho TypeScript 7.

**Sprint 1 Definition of Done:** Có output chứng minh baseline pass và peer constraint `<6.1.0`; chưa có dependency hoặc source file nào thay đổi.

---

## Sprint 2 — Install TypeScript 7 Toolchain

**Mục tiêu:** Cài TypeScript 7 compiler và TypeScript 6 compatibility API bằng dependency tree hợp lệ, không bypass npm.

**Thời lượng:** 30–45 phút.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

### S2.1 — Add explicit type-check scripts

- [x] Thêm vào `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:legacy": "tsc6 --noEmit"
  }
}
```

- [x] Không thay hoặc xóa các script `dev`, `build`, `start`, `lint`, `test` hiện có.

### S2.2 — Install the supported side-by-side packages

- [x] Chạy đúng lệnh sau để cập nhật cả manifest và lockfile:

```bash
npm install --save-dev --save-exact @typescript/native@npm:typescript@7.0.2 typescript@npm:@typescript/typescript6@6.0.2
```

- [x] Không chấp nhận install chỉ thành công khi thêm `--force` hoặc `--legacy-peer-deps`.

### S2.3 — Verify binaries and dependency tree

- [x] Chạy:

```bash
npx tsc --version
npx tsc6 --version
npm ls typescript @typescript/native eslint-config-next --depth=0
npm explain typescript
```

Expected:

```text
npx tsc: Version 7.0.2
npx tsc6: Version 6.0.2
npm ls: exit 0, no invalid peer dependency
typescript-eslint resolves compiler API through the TypeScript 6 compatibility alias
```

### S2.4 — Commit the toolchain

- [x] Commit only dependency changes:

```bash
git add package.json package-lock.json
git commit -m "chore(toolchain): add TypeScript 7 compiler"
```

**Sprint 2 Definition of Done:** TypeScript 7 `tsc` và TypeScript 6 `tsc6` cùng hoạt động; `npm ls` sạch; chưa sửa source code hoặc tắt compiler checks.

---

## Sprint 3 — Align tsconfig & Resolve Compiler Diagnostics

**Mục tiêu:** Làm `tsconfig.json` rõ ràng với default mới của TypeScript 7 và đạt parity giữa TypeScript 6/7.

**Thời lượng:** 45–90 phút.

**Files:**

- Modify: `tsconfig.json`
- Modify only if a diagnostic proves necessary: exact `.ts`/`.tsx` files named by `npm run typecheck`
- Test: existing `tests/**/*.test.ts`

### S3.1 — Make required global types explicit

TypeScript 7 đổi default `types` thành `[]`. Repo dùng Node globals như `process`, vì vậy thêm duy nhất option sau:

- [x] Update `compilerOptions` trong `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["node"]
  }
}
```

- [x] Không thêm `rootDir`: repo đang `noEmit`, đặt `rootDir: "./src"` sẽ loại hoặc làm sai quan hệ với tests và `.next/types` đang được include.
- [x] Không đổi `target: "ES2017"`, `module: "esnext"`, `moduleResolution: "bundler"` hoặc `paths` vì chúng đều hợp lệ với TypeScript 7.

### S3.2 — Compare TypeScript 6 and 7 diagnostics

- [x] Chạy legacy checker trước:

```bash
npm run typecheck:legacy
```

Expected: exit 0.

- [x] Chạy TypeScript 7 checker:

```bash
npm run typecheck
```

Expected: exit 0.

- [x] Nếu TypeScript 7 fail nhưng TypeScript 6 pass, ghi exact diagnostic code/file vào section `Migration Diagnostics` cuối ticket trước khi sửa.
- [x] Với mỗi diagnostic, sửa nguyên nhân tối thiểu trong file được compiler chỉ ra; không dùng cast `as any`, `@ts-ignore`, `@ts-expect-error`, nới `strict` hoặc thêm exclude để làm checker im lặng.
- [x] Chạy lại cả hai checker sau từng nhóm sửa; cả hai phải exit 0.

### S3.3 — Confirm Next.js uses the TypeScript 7 CLI path

- [x] Giữ `next.config.ts` không đổi. Next.js 16.3.2 bật project-local CLI checker mặc định; không cần thêm experimental config.
- [x] Chạy:

```bash
npm run build
```

Expected:

```text
Build exit 0
Không có lỗi "JavaScript compiler API unavailable"
Không có cảnh báo yêu cầu experimental.useTypeScriptCli=false
```

### S3.4 — Run regression suite

- [x] Chạy:

```bash
npm run lint
npm test
```

Expected: lint exit 0 và toàn bộ Vitest suite pass.

### S3.5 — Commit config and proven compatibility fixes

- [x] Nếu chỉ `tsconfig.json` thay đổi:

```bash
git add tsconfig.json
git commit -m "chore(toolchain): align config with TypeScript 7"
```

- [x] Nếu compiler buộc sửa source, stage đúng `tsconfig.json`, file source và test liên quan; dùng commit message:

```bash
git commit -m "fix(types): resolve TypeScript 7 diagnostics"
```

**Sprint 3 Definition of Done:** `tsc6`, `tsc`, ESLint, Vitest và Next build đều pass; không có suppressed diagnostic hoặc config relaxation.

---

## Sprint 4 — CI, Clean Install & Documentation

**Mục tiêu:** Biến TypeScript 7 thành gate bắt buộc trong CI và chứng minh lockfile tái lập được trên Node 20.

**Thời lượng:** 45–60 phút.

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/handoff/handoff.md`
- Verify/update if needed: `docs/superpowers/plans/2026-08-23-research-reliability.md`
- Update completion status: `docs/ticket/TASK-2.md`

### S4.1 — Add explicit TypeScript 7 CI gate

- [x] Thêm step ngay sau `npm ci` và trước lint:

```yaml
- name: Type check
  run: npm run typecheck
```

- [x] Không thêm legacy checker vào CI; `tsc6` chỉ là compatibility/rollback tool cho ESLint ecosystem trong giai đoạn TypeScript 7.0 chưa có JavaScript API.

### S4.2 — Verify a lockfile-only install path

- [x] Chạy:

```bash
npm ci
npx tsc --version
npx tsc6 --version
npm ls --depth=0
```

Expected:

```text
npm ci: exit 0 without --force/--legacy-peer-deps
tsc: Version 7.0.2
tsc6: Version 6.0.2
npm ls: exit 0
```

### S4.3 — Run the same gates as CI

- [x] Chạy theo đúng thứ tự CI:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: tất cả exit 0.

### S4.4 — Update project documentation

- [x] `README.md`: ghi TypeScript 7.0.2 trong tech stack và thêm `npm run typecheck` vào verification commands.
- [x] `docs/handoff/handoff.md`: ghi rõ compiler chính là TypeScript 7; TypeScript 6 package chỉ cung cấp compatibility API cho ESLint.
- [x] `docs/superpowers/plans/2026-08-23-research-reliability.md`: đảm bảo `Tech Stack` ghi TypeScript 7; không thay nội dung scraper plan.
- [x] `docs/ticket/TASK-2.md`: đánh dấu checkbox đã thực hiện và điền `Migration Diagnostics` bằng `None` nếu cả hai checker pass ngay.

### S4.5 — Commit CI and docs

- [x] Commit CI:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce TypeScript 7 typecheck"
```

- [x] Commit documentation:

```bash
git add README.md docs/handoff/handoff.md docs/superpowers/plans/2026-08-23-research-reliability.md docs/ticket/TASK-2.md
git commit -m "docs: document TypeScript 7 migration"
```

**Sprint 4 Definition of Done:** Clean `npm ci` trên dependency tree mới hoạt động; CI chạy TypeScript 7 trước lint/test/build; tài liệu mô tả đúng dual-package setup.

---

## Final Acceptance Criteria

- [x] `package.json` pin `@typescript/native` tới `npm:typescript@7.0.2`.
- [x] `package.json` pin `typescript` tới `npm:@typescript/typescript6@6.0.2` cho compiler API compatibility.
- [x] `npx tsc --version` trả `Version 7.0.2`.
- [x] `npx tsc6 --version` trả `Version 6.0.2`.
- [x] `npm ci` và `npm ls --depth=0` exit 0, không dùng peer-dependency bypass.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` đều exit 0.
- [x] CI có step `npm run typecheck` trước lint/test/build.
- [x] Không có `ignoreBuildErrors`, `@ts-ignore`, `as any` hoặc config relaxation được thêm bởi migration.
- [x] Không có business behavior, API contract, database schema hoặc UI thay đổi.

## Rollback

Chỉ rollback nếu TypeScript 7 tạo regression đã xác nhận mà không thể sửa trong scope ticket:

```bash
npm uninstall @typescript/native
npm install --save-dev typescript@5.9.3
```

Sau rollback:

```bash
npx tsc --version
npm run lint
npm test
npm run build
```

Expected `npx tsc --version`: `Version 5.9.3`. Không rollback bằng cách giữ TypeScript 7 rồi tắt type-check.

## Migration Diagnostics

None

## References

- [TypeScript 7.0 official announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useTypeScriptCli.md`
