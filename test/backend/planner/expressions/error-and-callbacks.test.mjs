import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /matches!\(error\.clone\(\), rt::TsonicError::NamedError\(_\)\)/u);
  assert.match(source, /rt::TsonicError::NamedError\(program_error\)/u);
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
  return xs.reduce((acc, x) => acc + x, 0) + evens.length + doubled.length + bonus;
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
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn roundtrip\(text: String\) -> Result<String, rt::TsonicError> \{/u);
  assert.match(text, /js_abi::json_parse\(&text\)\?/u);
  assert.match(text, /js_abi::json_stringify\(&value\)\?/u);
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
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn load\(path: String\) -> Result<String, rt::TsonicError> \{/u);
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_string\(&path, "utf8"\)/u);
  assert.doesNotMatch(text, /Ok\(tsonic_rust_node::fs::read_file_sync_string/u);
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
  assert.match(text, /pub fn catches\(text: String\) -> String \{/u);
  assert.match(text, /pub fn forwards\(text: String\) -> String \{/u);
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
  assert.match(text, /let value: js_abi::JsValue = js_abi::json_parse\("\{\\"tag\\":\\"tsonic\\"\}"\)\?;/u);
  assert.match(
    text,
    /let rendered: String = rt::option_coalesce\(\s*js_abi::json_stringify\(&value\)\?,\s*std::convert::identity,\s*\|\| String::from\(""\),\s*\);/u,
  );
  assert.match(text, /ok = js_string::includes_from_start\(&rendered, "tsonic"\);/u);
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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn initialize_state[^\n]*-> Result<[^,>]+, rt::TsonicError>/u);
  assert.match(text, /pub fn new\([^)]*\) -> Result<Derived, rt::TsonicError>/u);
  assert.match(text, /pub fn new\(\) -> Result<Initialized, rt::TsonicError>/u);
  assert.match(text, /fn dispatch_[^(]+\([^)]*\) -> Result<i32, rt::TsonicError>/u);
  assert.match(text, /fn read_through_base\([^)]*\) -> Result<i32, rt::TsonicError>/u);
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

test("terminating try scopes nested in non-tail branches return through the enclosing function", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "nested_try_return" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

function fail(): void {
  throw new DomainError("domain");
}

function recover(active: boolean): string | undefined {
  if (active) {
    try {
      fail();
      return "unreachable";
    } catch (error) {
      if (error instanceof DomainError) return error.message;
      throw error;
    }
  }
  return undefined;
}

export function main(): void {
  check(recover(true) === "domain");
  check(recover(false) === undefined);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Completion::Return\(value\) => return Ok\(value\)/u);
  assert.equal(validateGeneratedProject("nested-try-return", result.artifacts, { run: true }).status, 0);
});

test("nested arrow returns do not trip the try escape scan", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("x");
}

export function safe(xs: int32[]): int32 {
  let doubled_len: int32 = 0;
  try {
    risky();
    doubled_len = xs.map((x) => x * 2).length;
  } catch (error) {
    doubled_len = -1;
  }
  return doubled_len;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /xs\.map\(\|x\| x \* 2\)/u);
});

test("fallible provider rows are restricted to method, constructor, and property operations", async () => {
  const { createRustProviderPackage } = await import("../../../../dist/public/provider.js");
  assert.throws(
    () => createRustProviderPackage({
      id: "bad",
      displayName: "Bad",
      version: "1.0.0",
      modules: [{
        moduleSpecifier: "@bad",
        providerModuleId: "bad",
        exports: [{
          id: "@bad::X",
          name: "X",
          kind: "class",
          members: [{
            id: "@bad::X.indexer",
            name: "indexer",
            kind: "indexer",
            signatures: [{
              id: "@bad::X.indexer(index)",
              parameters: [{ name: "index", type: { kind: "number" } }],
              returnType: { kind: "source-primitive", name: "int32" },
            }],
          }],
        }],
      }],
      operations: [{
        exportId: "@bad::X",
        memberId: "@bad::X.indexer",
        signatureId: "@bad::X.indexer(index)",
        operationKind: "indexer",
        target: { form: "index" },
        resultCarrier: { kind: "source-primitive", name: "int32" },
        parameterCarriers: [{ kind: "source-primitive", name: "float64" }],
        isFallible: true,
        errorBoundary: "provider-native",
      }],
      crates: [],
    }),
    /isFallible is supported only on method, constructor, and property operations/u,
  );
});

test("concise fallible callables convert provider errors into the closed program error", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "concise_program_error" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

const normalize = (value: string): string => value.replaceAll("a", "b");

function fail(): void {
  throw new DomainError("domain");
}

export function main(): void {
  check(normalize("a") === "b");
  try {
    fail();
  } catch (_error) {
    check(true);
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(
    source,
    /js_string::replace_all\(value, "a", "b"\)\.map_err\(rt::TsonicError::from\)/u,
  );
  assert.equal(validateGeneratedProject("concise-program-error", result.artifacts, { run: true }).status, 0);
});

test("source-program callback operations retain the current project error domain", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

function risky(value: int32): int32 {
  if (value < 0) throw new DomainError("negative");
  return value;
}

export function sorted(values: int32[]): int32[] {
  return values.sort((left, right) => risky(left) - risky(right));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn sorted[\s\S]*?\{\n\s*values\s*\.try_sort/u);
  assert.doesNotMatch(source, /Ok::<_, rt::TsonicError>\(\s*values\s*\.try_sort/u);
});

test("capture-free exact forwarding callbacks use their native Rust function directly", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
function compare(left: number, right: number): number {
  if (left < 0 || right < 0) throw new Error("negative");
  return left - right;
}

export function sorted(values: number[]): number[] {
  return values.sort((left, right) => compare(left, right));
}

export function reversed(values: number[]): number[] {
  return values.sort((left, right) => compare(right, left));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.try_sort\(compare\)/u);
  assert.match(source, /values\.try_sort\(\|left, right\| compare\(right, left\)\)/u);
});
