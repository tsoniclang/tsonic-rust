import assert from "node:assert/strict";
import test from "node:test";
import { planRustBinaryHookCallPlan } from "../../../../dist/backend/planner/program/binary-hook-contexts.js";
import { rustNamedTargetType } from "../../../../dist/target-model/types/index.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";
import { fakeAstReader, fakeSourceFile } from "../../../helpers/fake-compile-input.mjs";

function fixture() {
  const file = fakeSourceFile({ statements: ["hook_context", "hook_argument"].map(text => ({ kindName: "KindIdentifier", text })) });
  const ast = { ...fakeAstReader([file]), forEachChild(node, visit) { for (const child of node.statements ?? []) visit(child); } };
  const component = { componentId: "root", root: true, programModuleName: "program" };
  const groups = [{ input: { targetArgumentIndex: 1, empty: { owner: rustNamedTargetType("native.group", "native::Group"), method: "new" },
    prepend: { path: "native::prepend" } }, components: [{ componentId: "root", children: [],
      accesses: [{ rootContextId: "context", projections: [] }] }] }];
  const program = { sourceFiles: [file], source: { ast }, configuration: { crateName: "probe" },
    binaryDispatchDemand: { forHook: () => groups }, dispatchContextDemand: { forComponent: () => ({ rootContextIds: ["context"] }) } };
  return { program, components: [component], errors: { domainsByComponentId: new Map([["root", { errorDomain: "runtime" }]]) } };
}

test("native binary hook bindings avoid authored names and evaluate arguments before borrowing context roots", () => {
  const { program, components, errors } = fixture();
  const diagnostics = [];
  const plan = planRustBinaryHookCallPlan({ id: "execute", path: "native::execute", phase: "async-execution" },
    { program }, components, errors, diagnostics);
  assert.equal(diagnostics.length, 0);
  assert.equal(plan !== undefined, true);
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
  const { program, components, errors } = fixture();
  program.dispatchContextDemand.forComponent = () => ({ rootContextIds: [] });
  const diagnostics = [];
  const hook = { id: "execute", path: "native::execute", phase: "async-execution" };
  assert.equal(planRustBinaryHookCallPlan(hook, { program }, components, errors, diagnostics), undefined);
  assert.equal(diagnostics[0].code, "RUST_BINARY_DISPATCH_INPUT_INVALID");
  program.binaryDispatchDemand.forHook = () => [];
  const plain = planRustBinaryHookCallPlan(hook, { program }, components, errors, []);
  const input = { kind: "path", path: "future" };
  assert.deepEqual(plain.call([input]), { kind: "call", path: "native::execute", args: [input] });
});
