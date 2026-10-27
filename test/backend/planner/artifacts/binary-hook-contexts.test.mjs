import assert from "node:assert/strict";
import test from "node:test";
import { planRustBinaryHookCallPlan } from "../../../../dist/backend/planner/program/binary-hook-contexts.js";
import { analyzeRustBinaryDispatchEmission } from "../../../../dist/analysis/project/binary-dispatch-emission.js";
import { createRustDispatchContextEmissionProducer } from "../../../../dist/analysis/program/records/operations/dispatch-contexts.js";
import { rustNamedTargetType } from "../../../../dist/target-model/types/index.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";
import { fakeAstReader, fakeSourceFile } from "../../../helpers/fake-compile-input.mjs";

// The analysis owner (analyzeRustBinaryDispatchEmission) selects the sealed binary dispatch record from the program's
// hook demand, components, error domains and dispatch roots; the planner renders the hook call from that record only.
function fixture() {
  const file = fakeSourceFile({ statements: ["hook_context", "hook_argument"].map(text => ({ kindName: "KindIdentifier", text })) });
  const base = fakeAstReader([file]);
  const ast = { ...base, is: { ...base.is, IsIdentifier: node => node.kindName === "KindIdentifier" },
    forEachChild(node, visit) { for (const child of node.statements ?? []) visit(child); } };
  const component = { componentId: "root", root: true, programModuleName: "program" };
  const groups = [{ input: { targetArgumentIndex: 1, empty: { owner: rustNamedTargetType("native.group", "native::Group"), method: "new" },
    prepend: { path: "native::prepend" } }, components: [{ componentId: "root", children: [],
      accesses: [{ rootContextId: "context", projections: [] }] }] }];
  const hook = { id: "execute", path: "native::execute", phase: "async-execution" };
  const program = { sourceFiles: [file], source: { ast }, configuration: { crateName: "probe" }, binaryHooks: [hook],
    records: { sourcePackageComponents: { get: () => [component] } },
    binaryDispatchDemand: { forHook: () => groups }, dispatchContextDemand: { forComponent: () => ({ rootContextIds: ["context"] }) } };
  const errors = { domainsByComponentId: new Map([["root", { errorDomain: "runtime", errorTypeIdentity: "rust.runtime.TsonicError" }]]) };
  return { program, errors, hook };
}

function analyze(current) {
  const producer = createRustDispatchContextEmissionProducer(() => {});
  producer.roots("root", [{ name: "dispatch_root_1", index: 0, carrier: rustNamedTargetType("native.context", "native::Context"),
    construct: { path: "native::Context::new", const: false } }]);
  const issues = analyzeRustBinaryDispatchEmission(current.program, current.errors, producer);
  return { issues, records: producer.records };
}

test("native binary hook bindings avoid authored names and evaluate arguments before borrowing context roots", () => {
  const current = fixture();
  const { issues, records } = analyze(current);
  assert.deepEqual(issues, []);
  const plan = planRustBinaryHookCallPlan(current.hook, { program: { records } });
  const argument = { kind: "call", path: "produce", args: [] };
  const selected = plan.call([argument]);
  assert.equal(selected.kind, "block");
  assert.equal(selected.body.statements[0].name, "hook_argument_2");
  assert.equal(selected.body.statements[0].init, argument);
  const borrowed = selected.body.statements[1].expr;
  assert.equal(borrowed.method, "with");
  assert.equal(borrowed.receiver.path, "probe::program::dispatch_root_1");
  const closure = borrowed.args[0];
  assert.equal(closure.params[0].name, "hook_context_2");
  assert.equal(closure.body.args[0].path, "hook_argument_2");
  assert.equal(closure.body.args[1].args[0].path, "hook_context_2");
  assert.doesNotMatch(printRustExpr(selected), /__tsonic_|Box::|clone\(/u);
  const repeated = plan.call([argument]);
  assert.equal(repeated.body.statements[0].name, "hook_argument_3");
  assert.equal(repeated.body.statements[1].expr.args[0].body.args[0].path, "hook_argument_3");
  assert.throws(() => plan.call([]), /sealed native lifecycle ABI/u);
});

test("native binary hooks reject missing physical roots and retain the context-free ABI", () => {
  const current = fixture();
  current.program.dispatchContextDemand.forComponent = () => ({ rootContextIds: [] });
  const missing = analyze(current);
  assert.equal(missing.issues[0].code, "RUST_BINARY_DISPATCH_INPUT_INVALID");
  assert.equal(missing.records.binaryDispatch.get(current.hook.id), undefined, "a refused hook publishes no dispatch record");
  current.program.binaryDispatchDemand.forHook = () => [];
  const contextFree = analyze(current);
  assert.deepEqual(contextFree.issues, []);
  const plain = planRustBinaryHookCallPlan(current.hook, { program: { records: contextFree.records } });
  const input = { kind: "path", path: "future" };
  assert.deepEqual(plain.call([input]), { kind: "call", path: "native::execute", args: [input] });
});
