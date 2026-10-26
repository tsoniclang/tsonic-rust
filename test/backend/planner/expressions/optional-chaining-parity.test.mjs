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

test("optional native slice indexing keeps fallible input conversion in the enclosing result", { timeout: 300_000 }, () => {
  const files = { "index.ts": `
import type { IncomingMessage } from "node:http";
import type { int32 } from "@tsonic/core/types.js";
type Values = NonNullable<IncomingMessage["headersDistinct"][string]>;
export function read(values: Values | undefined, index: int32): string | undefined {
  return values?.[index];
}
` };
  const options = { files, capabilities: [createTsonicPlugin()],
    target: { id: "rust", options: { outputType: "lib", crateName: "optional_native_slice" } } };
  const { program } = analyzeRust(options);
  const chains = [];
  const visit = node => {
    const chain = program.records.optionalChainEmission.get(node);
    if (chain !== undefined) chains.push(chain);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].closure, undefined, "the actual checked integer conversion cannot propagate errors from an Option closure");
  const { result } = compileRust(options);
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /checked_integer::<usize>\(index\)/u);
  assert.match(output, /match values\.as_ref\(\)/u);
  assert.doesNotMatch(output, /\.map\(\|optional_receiver|\.and_then\(\|optional_receiver/u);
  const root = writeGeneratedProject("optional-native-slice", [...result.artifacts, { path: "tests/selection.rs", text: `
use optional_native_slice::read;
#[test]
fn absence_is_lazy_and_present_indices_keep_native_conversion() {
    assert_eq!(read(None, -1).unwrap(), None);
    let values = vec!["native".to_owned()];
    assert_eq!(read(Some(&values), 0).unwrap(), Some("native".to_owned()));
    assert!(read(Some(&values), -1).is_err());
}
` }]);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt"]);
  runCargo(root, ["fmt", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("optional property reads lower through exact selected receiver and result carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_property" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, nativeUint } from "@tsonic/core/types.js";

interface Box { value: int32 }

function read(item: Box | undefined): int32 | undefined {
  return item?.value;
}

function length(value: string | undefined): nativeUint | undefined {
  return value?.length;
}

export function main(): void {
  check((read(undefined) ?? -1) === -1);
  check((read({ value: 7 }) ?? -1) === 7);
  check(length(undefined) === undefined);
  check((length(undefined) ?? 0) === 0);
  check((length("rust") ?? 0) === 4);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /item\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  assert.match(source, /value\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  validateGeneratedProject("optional-property", result.artifacts, { run: true });
});

test("optional element reads preserve lazy index evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_element" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;

function index(): int32 {
  calls += 1;
  return 0;
}

function first(values: int32[] | undefined): int32 | undefined {
  return values?.[index()];
}

export function main(): void {
  check((first(undefined) ?? -1) === -1);
  check(calls === 0);
  check((first([9]) ?? -1) === 9);
  check(calls === 1);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\s*\.as_ref\(\)\s*\.and_then\(\s*\|optional_receiver/u);
  assert.doesNotMatch(source, /\.transpose\(\)|\.flatten\(\)/u);
  assert.match(source, /index\(\)/u);
  validateGeneratedProject("optional-element", result.artifacts, { run: true });
});

test("optional provider properties retain provider identity inside the Option lane", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage()],
    files: {
      "index.ts": `
import { Store } from "@acme/platform";
import type { int32 } from "@tsonic/core/types.js";

export function count(store: Store | undefined): int32 | undefined {
  return store?.count;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/index.rs"),
    /store\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.count/su,
  );
  validateGeneratedProject("optional-provider-property", result.artifacts);
});

test("optional provider methods retain exact provider member identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [acmeTelemetryCapability()],
    files: {
      "index.ts": `
import { Meter } from "telemetry";
import type { int32 } from "@tsonic/core/types.js";

export function total(meter: Meter | undefined): int32 | undefined {
  return meter?.total();
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/index.rs"),
    /meter\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.total\(\)/su,
  );
  validateGeneratedProject("optional-provider-method", result.artifacts);
});

test("optional syntax on a checker-proven non-null receiver stays direct", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";

export function length(value: string): nativeUint {
  return value?.length;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /\.map\(/u);
  validateGeneratedProject("optional-non-null", result.artifacts);
});

test("optional project-source method calls preserve the selected method result", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_source_method" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

class Counter {
  current(): int32 {
    return 9;
  }
}

function read(counter: Counter | undefined): int32 | undefined {
  return counter?.current();
}

export function main(): void {
  check((read(undefined) ?? -1) === -1);
  check((read(new Counter()) ?? -1) === 9);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/index.rs"),
    /counter\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver.*optional_receiver\.current\(\)/su,
  );
  validateGeneratedProject("optional-source-method", result.artifacts, { run: true });
});

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
