import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, assertNoNativeCalls } from "../../../helpers/native-ast.mjs";
import { test } from "node:test";
import {
  acmePlatformPackage,
  acmeTelemetryCapability,
  acmeTestingPackage,
  artifactText,
  compileRust,
  analyzeRust,
} from "../../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { createTsonicPlugin } from "../../../../../rust-nodejs/dist/index.js";

test("optional JavaScript methods evaluate arguments only after the receiver guard", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_js_method" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;

function needle(): string {
  calls += 1;
  return "u";
}

function includes(value: string | undefined): boolean | undefined {
  return value?.includes(needle());
}

export function main(): void {
  check((includes(undefined) ?? false) === false);
  check(calls === 0);
  check(includes("rust") ?? false);
  check(calls === 1);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const includes = nativeFunction(result, "includes");
  const guarded = nativeNodes(includes.body, node => node.kind === "method-call" && node.method === "map");
  assert.equal(guarded.length, 1, "one optional receiver guard");
  assert.equal(nativeCalls(guarded[0].args[0], "needle").length, 1, "argument evaluated within the selected arm only");
  assert.equal(nativeCalls(includes.body, "needle").length, 1, "no eager or duplicated argument invocation");
  const calls = nativeCalls(guarded[0].args[0], "js_string::includes_from_start");
  assert.equal(calls.length, 1, "selected native string operation");
  assert.equal(calls[0].args.length, 2);
  assertNoNativeCalls(guarded[0].args[0], ["clone"], "optional receiver is borrowed rather than cloned");
  validateGeneratedProject("optional-js-method", result.artifacts, { run: true });
});
