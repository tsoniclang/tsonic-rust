import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider environment maps are local values rather than process markers", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_environment" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import process from "node:process";
import type { ProcessEnv, Signals } from "node:process";
function build(): NodeJS.ProcessEnv {
  const values: ProcessEnv = {};
  values["TSONIC_ENV_CHILD_ONLY"] = "child";
  return values;
}
export function main(): void {
  const values = build();
  const alias = values;
  check(alias["TSONIC_ENV_CHILD_ONLY"] === "child");
  alias["TSONIC_ENV_CHILD_ONLY"] = "changed";
  check(values["TSONIC_ENV_CHILD_ONLY"] === "changed");
  check(process.env["TSONIC_ENV_CHILD_ONLY"] === undefined);
  values["TSONIC_ENV_CHILD_ONLY"] = undefined;
  check(alias["TSONIC_ENV_CHILD_ONLY"] === undefined);
  const first: Signals = "SIGINT";
  const second: NodeJS.Signals = first;
  check(second === "SIGINT");
  let rejected = false;
  try { process.env["bad=name"] = "value"; } catch { rejected = true; }
  check(rejected);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-environment", result.artifacts, { run: true });
});

test("opaque default construction never drops authored fields", async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": `import type { ProcessEnv } from "node:process";
export const value: ProcessEnv = { authored: "must not disappear" };` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PROVIDER_OBJECT_LITERAL_CONTRACT_INVALID"));
  assert.equal(result.artifacts.length, 0);
});
