import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { createRustAnalysisContext } from "../../../dist/analysis/program/context.js";
import { analyzeRustProgram } from "../../../dist/analysis/program/analyze.js";
import { analyzeRustDispatchContextCatalog, analyzeRustRuntimeReferences } from "../../../dist/analysis/project/index.js";

function analyze(text, outputType = "bin") {
  let context;
  let stage;
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType } },
    files: { "index.ts": text }, compileTarget(request) {
      const references = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation, request.runtimeCrates);
      assert.equal(references.kind, "resolved", "the native runtime references are admitted");
      const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, references.plan.activeCrates);
      assert.equal(dispatch.kind, "resolved", "the checked native dispatch context is complete");
      const created = createRustAnalysisContext(request.input, request.providerSemantics, request.jsEnabled,
        request.rootPublishesLibrary, dispatch.plan);
      if (created.kind === "rejected") return created;
      context = created.value;
      stage = analyzeRustProgram(context, request.configuration.outputType);
      return context.diagnostics.length !== 0 ? { kind: "rejected", diagnostics: context.diagnostics }
        : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    } });
  return { context, stage, result };
}

function admitted(current) {
  assert.equal(current.result.diagnostics.length, 0,
    JSON.stringify(current.result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(current.stage !== undefined, true, "the real source owner publishes its completed graph");
  const { ast } = current.context;
  const graph = current.stage.nativeTasks;
  return { graph, ast, names: graph.owners.map(owner => ast.text(ast.name(owner))).sort() };
}

test("native task use threads through two ordinary source callers, not the spawned body's signature", () => {
  const current = analyze(`async function body(): Promise<void> { return; }
function schedule(): void { void body(); }
function outer(): void { schedule(); }
outer();`);
  const { graph, names } = admitted(current);
  assert.equal(names.join(","), "outer,schedule", "only the transitive scheduling callers need a scope");
  assert.equal(graph.spawns.length, 1, "the explicit void has one task owner");
  assert.equal(graph.calls.length, 2, "both source invocation edges receive one hidden argument");
  assert.equal("capturedOwners" in graph, false, "the supported direct-call graph has no scope-capture representation");
  assert.equal(graph.calls.every(call => call.targets.length === 1), true, "every hidden call edge has one exact checked target");
  assert.equal(graph.entries.length, 1, "the entry module owns the executor lifetime");
});

test("a retained native async owner keeps its exact source caller for later ownership selection", () => {
  const current = analyze(`async function body(): Promise<void> { return; }
async function schedule(): Promise<void> { void body(); }
void schedule();`);
  const { graph, names } = admitted(current);
  assert.equal(names.join(","), "schedule", "the async scheduling body is the only scoped callable");
  assert.equal(graph.calls.length, 1, "only the retained scheduling owner needs the hidden argument");
  assert.equal(graph.calls[0].targets[0] === graph.owners[0], true,
    "final scope ownership consumes the same checked scheduling owner, not an early blanket clone decision");
  assert.equal(graph.spawns.length, 2, "each authored explicit void has one spawn selection");
});

test("programs without native explicit void tasks have no scope participants", () => {
  const { graph } = admitted(analyze("function add(value: number): number { return value + 1; } add(1);"));
  assert.equal(graph.spawns.length + graph.owners.length + graph.calls.length + graph.entries.length, 0,
    "an unrelated native program has no executor ownership, parameters, captures or task queue work");
});

test("a public package scheduling function is refused before sealing its implicit ABI", () => {
  const current = analyze(`async function body(): Promise<void> { return; }
export function schedule(): void { void body(); }`, "lib");
  assert.equal(current.result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NATIVE_TASK_PUBLIC_SCOPE_UNSUPPORTED"), true,
    "the actual exported package boundary cannot silently gain a hidden executor parameter");
  assert.equal(current.stage === undefined, true, "a rejected scope ABI never reaches physical publication");
  assert.equal(current.result.artifacts.length, 0, "a source refusal emits nothing");
});

test("an executable export is not mistaken for a public package boundary", () => {
  const current = analyze(`async function body(): Promise<void> { return; }
export function schedule(): void { void body(); }
schedule();`);
  const { names } = admitted(current);
  assert.equal(names.join(","), "schedule", "the executable's ordinary helper retains its native scope ABI");
});

for (const [name, declaration, use, code] of [
  ["generator", "function* values(): Generator<number, void, unknown> { void body(); yield 1; }", "values().next();", "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED"],
  ["stored closure", "function make(): () => void { return (): void => { void body(); }; }", "const schedule = make(); schedule();", "RUST_NATIVE_TASK_SCOPE_OWNER_NOT_CLOSED"],
  ["class initializer", "class Value { readonly started = void body(); }", "new Value();", "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED"],
  ["entry initializer", "const started = void body();", "void started;", "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED"],
]) test(`native spawning refuses the ${name} context before physical publication`, () => {
  const current = analyze(`async function body(): Promise<void> { return; } ${declaration} ${use}`);
  assert.equal(current.result.diagnostics.some(diagnostic => diagnostic.code === code), true,
    `${name}: the actual source context is refused precisely`);
  assert.equal(current.stage === undefined, true, `${name}: unsupported scope storage never reaches physical analysis`);
  assert.equal(current.result.artifacts.length, 0, `${name}: a rejected source capability emits nothing`);
});
