import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

// RULINGS 2026-10-22: on the native surface `.catch`/`.then` on a native Promise body lower natively and an `unknown`
// rejection reason holds the program error.
test("native Promise continuations route rejections to unknown handlers as the program error", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
      async function fail(flag: boolean): Promise<number> { if (flag) throw new Error("native rejection"); return 1; }
      export async function main(): Promise<void> {
        let seen = 0;
        const recovered = await fail(true).catch((reason: unknown): number => {
          if (reason instanceof Error && reason.message === "native rejection") seen += 1;
          return 2;
        });
        const fulfilled = await fail(false).then(value => value + 10, (reason: unknown): number => reason instanceof Error ? -1 : -2);
        const rejected = await fail(true).then(value => value + 10, (reason: unknown): number => reason instanceof Error ? -1 : -2);
        if (recovered !== 2 || fulfilled !== 11 || rejected !== -1 || seen !== 1) throw new Error("native continuations");
      }
      await main();
    `,
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /async fn native_promise_catch/u);
  assert.match(source, /async fn native_promise_then/u);
  assert.doesNotMatch(source, /JsValue|TsValue|dyn Future|Box::pin/u, "the rejection reason is the program error, not a dynamic value");
  validateGeneratedProject("native-promise-continuations", result.artifacts, { run: true });
});

test("native Promise then and catch retain named and stored infallible callback contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
      async function seed(): Promise<number> { return 1; }
      async function fail(): Promise<number> { throw new Error("expected rejection"); }
      function same(value: number): number { return value; }
      function recover(reason: unknown): number { return 2; }
      export async function main(): Promise<void> {
        const storedSame = same;
        const storedRecover = recover;
        const namedThen = await seed().then(same);
        const storedThen = await seed().then(storedSame);
        const namedCatch = await fail().catch(recover);
        const storedCatch = await fail().catch(storedRecover);
        if (namedThen !== 1 || storedThen !== 1 || namedCatch !== 2 || storedCatch !== 2)
          throw new Error("native callback contract");
      }
      await main();
    `,
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /async fn native_promise_then/u, "then remains a native continuation");
  assert.match(source, /async fn native_promise_catch/u, "catch remains a native continuation");
  assert.doesNotMatch(source, /JsValue|TsValue|dyn Future|Box::pin/u, "fixed native errors introduce no dynamic carrier or boxed future");
  validateGeneratedProject("native-promise-infallible-callbacks", result.artifacts, { run: true });
});
