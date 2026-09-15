import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("builtin Error narrowing preserves messages, native subtypes and identity through unknown", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_error_values" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
type Failure = Error;
function store(error: Failure): unknown { return error; }
function describe(value: unknown): string {
  if (value instanceof Error) {
    const selected = value;
    return selected.name + ":" + selected.message;
  }
  return "other";
}
function classify(value: unknown): string {
  if (value instanceof RangeError) return "range:" + value.message;
  if (value instanceof TypeError) return "type:" + value.message;
  if (value instanceof URIError) return "uri:" + value.message;
  if (value instanceof Error) return "error:" + value.message;
  return "other";
}
function same(left: unknown, right: unknown): boolean { return left === right; }
export function main(): void {
  const original = new Error("failure");
  const alias = original;
  const closed = store(original);
  check(original === alias && original !== new Error("failure"));
  check(same(closed, store(original)) && !same(closed, store(new Error("failure"))));
  check(describe(closed) === "Error:failure");
  check(describe(new RangeError("bounds")) === "RangeError:bounds");
  check(classify(original) === "error:failure");
  check(classify(new RangeError("bounds")) === "range:bounds");
  check(classify(new TypeError("type")) === "type:type");
  check(classify(new URIError("uri")) === "uri:uri");
  check(classify("failure") === "other" && classify(1) === "other");
  check(classify(null) === "other" && classify(undefined) === "other");
  check(new Error("direct") instanceof Error);
  check(new TypeError("direct") instanceof TypeError);
  check(!(new TypeError("direct") instanceof RangeError));
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /JsValue::from_error/u);
  assert.match(source, /\.is_error\(\)/u);
  assert.match(source, /\.is_error_kind\(rt::JsErrorKind::RangeError\)/u);
  assert.match(source, /\.error_value\(\)/u);
  assert.equal(validateGeneratedProject("compiler-provider-errors", result.artifacts, { run: true }).status, 0);
});

test("native profile Error identity and properties do not require a JS value carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_error_values" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
export function main(): void {
  const error = new Error("native");
  const alias = error;
  check(error === alias && error !== new Error("native"));
  check(error instanceof Error);
  check(error.name === "Error" && error.message === "native");
  const stored = error.message;
  check(stored === "native");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /JsError::has_same_identity/u);
  assert.match(source, /JsError::has_distinct_identity/u);
  assert.doesNotMatch(source, /JsValue|\.error_value\(/u);
  assert.doesNotMatch(source, /\.message\(\)\.to_owned\(\)\s*==/u);
  assert.equal(validateGeneratedProject("native-error-values", result.artifacts, { run: true }).status, 0);
});

test("same-spelled project Error stays on project identity and field operations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "project_error_identity" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Error {
  message: string;
  constructor(message: string) { this.message = message; }
}
function describe(error: Error): string {
  if (error instanceof Error) return error.message;
  return "other";
}
export function main(): void {
  const error = new Error("project");
  error.message = "changed";
  check(describe(error) === "changed");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.(?:is_error|is_error_kind|error_value)\(/u);
  assert.equal(validateGeneratedProject("project-error-identity", result.artifacts, { run: true }).status, 0);
});

for (const surfaces of [[], ["js"]]) {
  test(`builtin Error exposes its optional creation stack in the ${surfaces.length === 0 ? "native" : "JS"} profile`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "error_creation_stack" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
function create(): Error { return new Error("failure 😀"); }
function read(error: Error): string | undefined { return error.stack; }
export function main(): void {
  const error = create();
  const alias = error;
  const first = read(alias);
  check(first !== undefined);
  if (first !== undefined) {
    check(first !== "");
    ${surfaces.length === 0 ? "" : 'check(first.startsWith("Error: failure 😀\\n")); check(first.length > "Error: failure 😀\\n".length);'}
  }
  check(read(error) === first);
  check(error === alias);
}
` },
    });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /Option<String>/u);
    assert.match(source, /\.stack\(\)/u);
    assert.equal(validateGeneratedProject(`error-creation-stack-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
  });
}

for (const [name, source] of [
  ["direct", `export function change(error: Error): void { error.message = "changed"; }`],
  ["alias", `export function change(error: Error): void { const alias = error; alias.name = "changed"; }`],
  ["narrowed", `export function change(error: unknown): void { if (error instanceof Error) error.message = "changed"; }`],
  ["stack", `export function change(error: Error): void { error.stack = "changed"; }`],
]) {
  test(`builtin Error ${name} mutation rejects rather than mutating a detached diagnostic clone`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.diagnostics.some(({ code }) => code === "RUST_BUILTIN_ERROR_MUTATION_UNSUPPORTED"),
      JSON.stringify(result.diagnostics));
  });
}
