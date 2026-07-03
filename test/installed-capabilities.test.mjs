import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeSuperbunapiCapability, acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { composeRustCapabilities } from "../dist/index.js";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("superbunapi lowers through the generic capability mechanism", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    packages: [acmeSuperbunapiCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "superbun_proof" } },
    files: {
      "index.ts": `
import { serve } from "superbunapi";
import { check } from "@acme/testing";

export function main(): void {
  const banner = serve(3000);
  check(banner === "superbunapi:3000");
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_superbunapi::serve\(3000\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /acme_superbunapi = \{ path = /u);
  const run = validateGeneratedProject("superbun-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("node modules fail cleanly without the capability installed", async () => {
  // No installed capability owns node:fs, so the module does not resolve
  // and checking fails deterministically before any artifact exists.
  assert.throws(
    () => compileRust({
      surfaces: ["js"],
      files: { "index.ts": `import { readFileSync } from "node:fs";\n\nexport function f(path: string): string {\n  return readFileSync(path, "utf8");\n}\n` },
    }),
    /TypeScript diagnostics/u,
  );
});

test("unused installed capability contributes no runtime crates", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeSuperbunapiCapability()],
    files: { "index.ts": "export function f(): boolean {\n  return true;\n}\n" },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!artifactText(result, "Cargo.toml").includes("acme_superbunapi"));
});

test("duplicate module ownership fails closed in local composition", async () => {
  const first = acmeSuperbunapiCapability();
  const second = acmeSuperbunapiCapability();
  assert.throws(
    () => composeRustCapabilities("rust", [first, second]),
    /Ambiguous Tsonic capability ownership/u,
  );
});

test("wrong-target capabilities fail closed in local composition", async () => {
  const capability = { ...acmeSuperbunapiCapability(), targetId: "csharp" };
  assert.throws(
    () => composeRustCapabilities("rust", [capability]),
    /targets 'csharp', not selected target 'rust'/u,
  );
});
