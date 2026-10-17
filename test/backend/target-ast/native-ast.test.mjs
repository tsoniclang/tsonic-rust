import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { nativeNodes, nativeSource, nativeFunction, nativeCalls, nativeMethods, nativeType,
  nativeCallableContract, nativeScopedBinding, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

test("native AST inspection preserves source order and visits shared syntax exactly once", () => {
  const first = { kind: "call", path: "first", args: [] };
  const second = { kind: "call", path: "second", args: [] };
  const root = { expressions: [first, second, first] };
  root.cycle = root;
  assert.deepEqual(nativeNodes(root, node => node.kind === "call").map(node => node.path), ["first", "second"]);
  assert.deepEqual(nativeCalls(root, "first"), [first]);
  assert.deepEqual(nativeCalls(root, "absent"), []);
  assert.deepEqual(nativeMethods(root, "first"), []);
});

test("native AST inspection rejects absent or ambiguous plans instead of parsing generated text", () => {
  assert.throws(() => nativeSource({ artifacts: [{ path: "src/index.rs", text: "fn wanted() {}" }] }),
    { code: "ERR_ASSERTION" });
  const source = { items: [{ kind: "function", name: "wanted" }, { kind: "function", name: "wanted" }] };
  const result = { plan: { artifacts: [{ kind: "source", path: "src/index.rs", model: source }] } };
  assert.throws(() => nativeFunction(result, "wanted"), { code: "ERR_ASSERTION" });
  assert.throws(() => nativeSource(result, "src/missing.rs"), { code: "ERR_ASSERTION" });
  assert.throws(() => assertNoNativeCalls({ kind: "method-call", method: "clone", args: [] }, ["clone"], "copy"),
    { code: "ERR_ASSERTION" });
});

test("native scoped bindings use the exact invocation and lexical parameter, never an ancestor guess", () => {
  const invocation = { kind: "call", path: "provider::perform", args: [] };
  const inner = { kind: "method-call", method: "with", args: [
    { kind: "closure", params: [{ name: "inner" }], body: invocation },
  ] };
  const outer = { kind: "method-call", method: "with", args: [
    { kind: "closure", params: [{ name: "outer" }], body: inner },
  ] };
  assert.equal(nativeScopedBinding(outer, invocation, "inner") === inner, true);
  assert.equal(nativeScopedBinding(outer, invocation, "outer") === outer, true);
  assert.throws(() => nativeScopedBinding(outer, { ...invocation }, "inner"), { code: "ERR_ASSERTION" });
  assert.throws(() => nativeScopedBinding(outer, invocation, "missing"), { code: "ERR_ASSERTION" });
  assert.throws(() => nativeScopedBinding([inner, { ...inner }], invocation, "inner"), { code: "ERR_ASSERTION" });
});

test("native dispatch bindings prove their exact declared owner rather than a matching variable spelling", () => {
  const invocation = { kind: "call", path: "provider::perform", args: [] };
  const scope = { kind: "method-call", method: "with", receiver: { kind: "path", path: "crate::program::root" },
    args: [{ kind: "closure", params: [{ name: "context" }], body: invocation }] };
  const declaration = { kind: "thread-local", name: "root", type: { kind: "named", path: "provider::Context" },
    value: { kind: "call", path: "provider::Context::new", args: [] }, constInitializer: true };
  const result = { plan: { artifacts: [{ kind: "source", path: "src/program.rs", model: { items: [declaration] } }] } };
  assert.equal(nativeDispatchBinding(result, scope, invocation, "context", "provider::Context") === scope, true);
  assert.throws(() => nativeDispatchBinding(result, scope, invocation, "context", "provider::Other"), { code: "ERR_ASSERTION" });
  assert.throws(() => nativeDispatchBinding({ plan: { artifacts: [] } }, scope, invocation, "context", "provider::Context"),
    { code: "ERR_ASSERTION" });
});

test("the canonical checked compilation exposes its exact selected native plan and artifacts", () => {
  const { result, source } = compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function apply(value: int32, callback: (value: int32) => int32): int32 { return callback(value); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(result.program.source.ast === source.ast, true, "native plan belongs to the same checked source");
  const apply = nativeCallableContract(result, "apply", 1, [nativeType("i32")], nativeType("i32"));
  assert.equal(apply.params[1].type.kind, "reference");
  assert.equal(result.artifacts.some(artifact => artifact.path === "src/index.rs" && artifact.text.length > 0), true);
  assert.equal(Object.isFrozen(result.program), true, "the helper exposes the actual published program");
});

test("Rust helper library defaults never infer output kind from the authored main name", () => {
  const { result, harness } = compileRust({ files: { "index.ts": "export function main(): void {}" } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(harness.target.options.outputType, "lib");
  assert.equal(harness.project.targets[0].options.outputType, "lib");
  assert.equal(result.artifacts.some(artifact => artifact.path === "src/main.rs"), false);
});

test("Rust helper keeps source and target option validation before native planning", () => {
  assert.throws(() => compileRust({ files: { "index.ts": "export const invalid: number = 'text';" } }), /TypeScript diagnostics/u);
  assert.throws(() => compileRust({ target: { id: "rust", options: { outputType: "invalid" } },
    files: { "index.ts": "export const value = 1;" } }), /outputType/u);
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": "export function main(): void {}" } });
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "TSONIC_UNCALLED_BINARY_ENTRY_MAIN"), true);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.plan === undefined, true, "entry rejection never constructs a native output plan");
});
