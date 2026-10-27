import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, nativeType, nativeBorrow, assertNoNativeCalls } from "../../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`Error construction without a message preserves throwing and catching (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "empty_error_message" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
export function main(): void {
  const error = new Error();
  check(error.message === "");
  check(error.name === "Error");
  let caught = false;
  try { throw new Error(); }
  catch { caught = true; }
  check(caught);
}
main();
` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("empty-error-message", result.artifacts, { run: true });
  });
}

test("Error subclasses retain exact inherited field selection for reads and writes", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "error_subclass_fields" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class NamedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamedError";
  }
}

export function main(): void {
  const error = new NamedError("failure");
  check(error.name === "NamedError" && error.message === "failure");
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("error-subclass-fields", result.artifacts, { run: true }).status, 0);
});

test("caught project errors narrow through exact closed program variants", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "caught_project_error" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class NamedError extends Error {
  value: int32;

  constructor(value: int32) {
    super("named");
    this.value = value;
  }
}

function read(named: boolean): string {
  try {
    if (named) throw new NamedError(42);
    throw new Error("ordinary");
  } catch (error) {
    return error instanceof NamedError ? \`value=\${error.value}\` : \`\${error}\`;
  }
}

export function main(): void {
  check(read(true) === "value=42");
  check(read(false).includes("ordinary"));
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /match &error \{\s*rt::ErrorTransport::NamedError\(_\) => true,/u);
  assert.match(source, /rt::ErrorTransport::NamedError\(program_error\)/u);
  assert.doesNotMatch(source, /matches!\(error\.clone\(\)/u);
  assert.equal(validateGeneratedProject("caught-project-error", result.artifacts, { run: true }).status, 0);
});

test("array callbacks lower to Rust closures over the canonical JS array carrier", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function stats(xs: int32[]): int32 {
  const doubled = xs.map((x) => x * 2);
  const evens = doubled.filter((x) => x % 2 === 0);
  const any_big = xs.some((x) => x > 2);
  const all_positive = xs.every((x) => x > 0);
  let bonus: int32 = 0;
  if (any_big && all_positive) {
    bonus = 1;
  }
  return xs.reduce((acc, x) => acc + x, 0) + (evens.length as int32) + (doubled.length as int32) + bonus;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /xs\.map\(\|x\| x \* 2\)/u);
  assert.match(text, /doubled\.filter\(\|x\| x % 2 == 0\)/u);
  assert.match(text, /xs\.some\(\|x\| x > 2\)/u);
  assert.match(text, /xs\.every\(\|x\| x > 0\)/u);
  assert.match(text, /xs\.reduce\(0, \|acc, x\| acc \+ x\)/u);
});

test("fallible JavaScript callbacks use explicit fallible ABIs across collection families", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "fallible_callbacks" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function risky(value: int32): int32 {
  if (value < 0) {
    throw new Error("negative");
  }
  return value;
}

export function main(): void {
  const values: int32[] = [1, 2, 3];
  check(values.map((value, _index, _owner) => risky(value)).length === 3);
  check(values.filter(() => risky(1) > 0).length === 3);
  check(values.findIndex((value, _index) => risky(value) === 2) === 1);
  check(values.some((value) => risky(value) === 2));
  check(values.every(() => risky(1) > 0));

  let total: int32 = 0;
  values.forEach((value, _index, _owner) => {
    total += risky(value);
  });
  check(total === 6);
  check(values.reduce<int32>((sum, value, _index, _owner) => risky(sum + value), 0) === 6);
  check(values.reduce((sum) => risky(sum * 2)) === 4);

  const map = new Map<string, int32>();
  map.set("a", 1).set("b", 2);
  map.forEach((value, _key, _owner) => {
    total += risky(value);
  });

  const set = new Set<int32>();
  set.add(1).add(2);
  set.forEach((value, _key) => {
    total += risky(value);
  });
  check(total === 12);

  const failing: int32[] = [1, -1, 3];
  let visits: int32 = 0;
  let caught = false;
  try {
    failing.some((value) => {
      visits += 1;
      return risky(value) > 10;
    });
  } catch (_error) {
    caught = true;
  }
  check(caught && visits === 2);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /values\s*\.try_map_with_array/u);
  assert.match(text, /values\s*\.try_filter_zero/u);
  assert.match(text, /values\s*\.try_find_index_with_index/u);
  assert.match(text, /values\s*\.try_some/u);
  assert.match(text, /values\s*\.try_every_zero/u);
  assert.match(text, /values\s*\.try_for_each/u);
  assert.match(text, /values\s*\.try_reduce_with_array\(0,/u);
  assert.match(text, /values\s*\.try_reduce_from_first_accumulator/u);
  assert.match(text, /map\s*\.try_for_each/u);
  assert.match(text, /set\s*\.try_for_each_value_key/u);
  assert.equal(validateGeneratedProject("fallible-callbacks", result.artifacts, { run: true }).status, 0);
});

test("JSON round-trips through fallible rows in a throwing context", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function roundtrip(text: string): string {
  const value = JSON.parse(text);
  return JSON.stringify(value) ?? "";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const roundtrip = nativeFunction(result, "roundtrip");
  assert.deepEqual(roundtrip.params.map(parameter => parameter.type), [nativeBorrow(nativeType("str"))]);
  assert.deepEqual(roundtrip.returnType, nativeType("String"));
  assert.equal(roundtrip.errorType.identity, "tsonic-rust-runtime:TsonicError");
  const propagated = nativeNodes(roundtrip.body, node => node.kind === "try");
  assert.equal(propagated.length, 2, "both fallible JSON operations propagate");
  assert.deepEqual(propagated.map(node => node.expr.path), ["js_abi::json_parse", "js_abi::json_stringify"]);
  assert.equal(propagated[0].expr.args[0].path, "core::convert::AsRef::<str>::as_ref");
  assert.deepEqual(propagated[0].expr.args[0].args, [{ kind: "path", path: "text" }]);
  assert.deepEqual(propagated[1].expr.args, [{ kind: "reference", expr: { kind: "path", path: "value" } }]);
});

test("node fs read lowers through the fallible provider row", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { readFileSync } from "node:fs";

export function load(path: string): string {
  return readFileSync(path, "utf8");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const load = nativeFunction(result, "load");
  assert.deepEqual(load.params.map(parameter => parameter.type), [nativeBorrow(nativeType("str"))]);
  assert.deepEqual(load.returnType, nativeType("String"));
  assert.equal(load.errorType.identity, "rust.node.NodeError");
  const calls = nativeCalls(load.body, "tsonic_rust_node::fs::read_file_sync_string");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [{ kind: "path", path: "path" }] },
    { kind: "str-literal", value: "utf8" },
  ]);
  assert.equal(nativeCalls(load.body, "Ok").filter(call => nativeCalls(call, "tsonic_rust_node::fs::read_file_sync_string").length !== 0).length,
    0, "a Result-returning provider operation is not wrapped as a successful Result payload");
  assertNoNativeCalls(load.body, ["clone", "to_owned", "to_string"], "provider arguments stay borrowed");
});

test("caught provider failures do not make project-source callers fallible", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function catches(text: string): string {
  let result = "";
  try {
    const value = JSON.parse(text);
    result = JSON.stringify(value) ?? "";
  } catch (error) {
    result = "invalid";
  }
  return result;
}

export function forwards(text: string): string {
  return catches(text);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn catches\(text: &str\) -> String \{/u);
  assert.match(text, /pub fn forwards\(text: &str\) -> String \{/u);
  assert.match(text, /catches\(text\)/u);
  assert.doesNotMatch(text, /pub fn (?:catches|forwards)[^{]+TsonicResult/u);
  assert.doesNotMatch(text, /catches\(text\)\?/u);
});

test("provider-result arguments close after later source operations without eager conversion rejection", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function inspectJson(): boolean {
  let ok = false;
  try {
    const value = JSON.parse("{\\"tag\\":\\"tsonic\\"}");
    const rendered = JSON.stringify(value) ?? "";
    ok = rendered.includes("tsonic");
  } catch (error) {
    ok = false;
  }
  return ok;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let value: js_abi::JsValue =\s*match js_abi::json_parse\("\{\\"tag\\":\\"tsonic\\"\}"\)\s*\.map_err::<crate::index::NativeErrors2<rt::TsonicError, rt::JsError>, _>\(\s*crate::index::NativeErrors2::<rt::TsonicError, rt::JsError>::Error1,\s*\) \{\s*Ok\(value\) => value,\s*Err\(error\) => break 'try_body Err\(error\),/u);
  assert.match(
    text,
    /let rendered: String = match js_abi::json_stringify\(&value\)\s*\.map_err\(crate::index::NativeErrors2::<rt::TsonicError, rt::JsError>::Error0\)\s*\{\s*Ok\(value\) => value,\s*Err\(error\) => break 'try_body Err\(error\),\s*\}\s*\.unwrap_or_default\(\);/u,
  );
  assert.match(text, /ok = js_string::includes_from_start\(\s*core::convert::AsRef::<str>::as_ref\(&rendered\),\s*"tsonic",?\s*\);/u);
});

test("awaited fallible project-source calls apply try after await", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export async function risky(): Promise<string> {
  throw new Error("boom");
}

export async function forwards(): Promise<string> {
  return await risky();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn risky\(\) -> Result<String, rt::TsonicError>/u);
  assert.match(text, /pub async fn forwards\(\) -> Result<String, rt::TsonicError>/u);
  assert.match(text, /pub async fn forwards\(\) -> Result<String, rt::TsonicError> \{\n    risky\(\)\.await\n\}/u);
  assert.doesNotMatch(text, /risky\(\)\.await\?/u);
  assert.doesNotMatch(text, /risky\(\)\?\.await/u);
});

test("generated cargo binary proves callbacks, errors, JSON, and fs at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "final_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { readFileSync } from "node:fs";
import { check } from "@acme/testing";

export function risky(flag: boolean): int32 {
  if (flag) {
    throw new Error("boom");
  }
  return 7;
}

export function main(): void {
  const xs: int32[] = [1, 2, 3];
  check(xs.map((x) => x * 2).length === 3);
  check(xs.reduce((acc, x) => acc + x, 0) === 6);
  check(xs.some((x) => x === 2));
  check(xs.every((x) => x > 0));
  check(xs.filter((x) => x > 1).length === 2);

  let outcome: int32 = 0;
  try {
    outcome = risky(true);
  } catch (error) {
    outcome = -1;
  }
  check(outcome === -1);
  try {
    outcome = risky(false);
  } catch (error) {
    outcome = -2;
  }
  check(outcome === 7);

  let json_ok = false;
  try {
    const value = JSON.parse("{\\"name\\": \\"tsonic\\", \\"count\\": 3}");
    const text = JSON.stringify(value) ?? "";
    json_ok = text.includes("tsonic");
  } catch (error) {
    json_ok = false;
  }
  check(json_ok);

  let manifest = "";
  try {
    manifest = readFileSync("Cargo.toml", "utf8");
  } catch (error) {
    manifest = "";
  }
  check(manifest.includes("final_proof"));
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("final-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("static fallible methods propagate with ? through type paths", async () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Machine {
  state: int32;

  constructor(state: int32) {
    this.state = state;
  }

  static risky(flag: boolean): int32 {
    if (flag) {
      throw new Error("nope");
    }
    return 3;
  }
}

export function drive(): int32 {
  return Machine.risky(false);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn risky\(flag: bool\) -> Result<i32, rt::TsonicError> \{/u);
  assert.match(text, /pub fn drive\(\) -> Result<i32, rt::TsonicError> \{\n    Machine::risky\(false\)\n\}/u);
  assert.doesNotMatch(text, /Ok\(Machine::risky\(false\)\?\)/u);
});

test("constructor and virtual-call fallibility close over exact project dependencies", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "project_fallibility_closure" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function checkedValue(value: int32): int32 {
  if (value < 0) {
    throw new Error("negative");
  }
  return value;
}

class Base {
  value: int32;

  constructor(value: int32) {
    this.value = checkedValue(value);
  }

  read(): int32 {
    return this.value;
  }
}

class Derived extends Base {
  constructor(value: int32) {
    super(value);
  }

  read(): int32 {
    return checkedValue(this.value + 1);
  }
}

class Inherited extends Base {}

class Initialized {
  value: int32 = checkedValue(40);
}

function readThroughBase(value: Base): int32 {
  return value.read();
}

export function main(): void {
  check(readThroughBase(new Derived(41)) === 42);
  check(readThroughBase(new Inherited(41)) === 41);
  check(new Initialized().value === 40);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let field_value: i32 = checkedValue\(40\)\?;/u);
  assert.doesNotMatch(text, /fn initialize_state/u);
  assert.match(text, /pub fn new\([^)]*\) -> Result<Derived, rt::TsonicError>/u);
  assert.match(text, /pub fn new\(\) -> Result<Initialized, rt::TsonicError>/u);
  assert.match(text, /fn dispatch_[^(]+\([^)]*\) -> Result<i32, rt::TsonicError>/u);
  assert.match(text, /fn readThroughBase\([^)]*\) -> Result<i32, rt::TsonicError>/u);
  assert.equal(validateGeneratedProject("project-fallibility-closure", result.artifacts, { run: true }).status, 0);
});

test("catch returns propagate through exact completion state in fallible functions", async () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("x");
}

export function fallback(flag: boolean): int32 {
  let value: int32 = 0;
  try {
    value = risky();
  } catch (error) {
    return 2;
  }
  if (flag) {
    return risky();
  }
  return value + 1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn fallback\(flag: bool\) -> Result<i32, rt::TsonicError> \{/u);
  assert.match(text, /Ok\(rt::Completion::Return\(2\)\)/u);
  assert.match(text, /rt::Completion::Return\(value\) => return Ok\(value\)/u);
  assert.match(text, /return risky\(\);/u);
  assert.doesNotMatch(text, /return Ok\(risky\(\)\?\);/u);
});
