import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("grand proof: js surface, node, third-party, async, JSON, RegExp, multi-module in one binary", { timeout: 300_000 }, async () => {
  const { nodejsCapability, acmeSuperbunapiCapability } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeSuperbunapiCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "grand_proof" } },
    files: {
      "text.ts": `
export function slug(value: string): string {
  const joined = value.replace(/\\s+/g, "-");
  return joined.toLowerCase();
}
`,
      "index.ts": `
import { slug } from "./text.js";
import { serve } from "superbunapi";
import { writeFile, readFile, rm } from "node:fs/promises";
import { platform } from "node:process";
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export async function roundtrip(name: string): Promise<int32> {
  await writeFile(name, "grand proof", "utf8");
  const text = await readFile(name, "utf8");
  await rm(name);
  return text.length as int32;
}

export function main(): void {
  let ok = false;
  try {
    check(slug("Grand  Proof") === "grand-proof");
    check(serve(4000) === "superbunapi:4000");
    check(platform.length > 0);
    const value = JSON.parse("{\\"tag\\": \\"tsonic\\"}");
    const rendered = JSON.stringify(value) ?? "";
    check(rendered.includes("tsonic"));
    check(Math.floor(11.9) === 11);
    const xs: int32[] = [1, 2, 3];
    const doubled = xs.map((x) => x * 2);
    check(doubled.reduce((acc, x) => acc + x, 0) === 12);
    ok = true;
  } catch (error) {
    ok = false;
  }
  check(ok);
}
main();
`,
    },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const run = validateGeneratedProject("grand-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
