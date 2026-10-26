import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { createRustBreakTarget, createRustLoopTarget } from "../../../../dist/backend/planner/statements/loop-regions.js";
import { planDoStatement, planIfStatement } from "../../../../dist/backend/planner/statements/statement-conditionals.js";
import { planLabeledStatement } from "../../../../dist/backend/planner/statements/statement-labels.js";
import { planSwitchStatement } from "../../../../dist/backend/planner/statements/switch-statements.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

const source = `
import type { int32 } from "@tsonic/core/types.js";

export function guarded(flag: boolean): void {
  if (flag) { }
}

export function labeled(flag: boolean): void {
  done: { if (flag) break done; }
}

export function repeated(flag: boolean): void {
  do { } while (flag);
}

export function choose(value: int32): int32 {
  switch (value) { case 1: return 1; default: return 0; }
}
`;

function analyzedProgram() {
  return analyzeRust({ files: { "index.ts": source } }).program;
}

function findNode(program, predicate) {
  const { ast } = program.source;
  let found;
  const visit = node => {
    if (found !== undefined) return;
    if (predicate(ast, node)) {
      found = node;
      return;
    }
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  assert.equal(found !== undefined, true, "the checked fixture contains the planned construct");
  return found;
}

function planContext(program, node, state = {}) {
  const { ast } = program.source;
  return {
    input: { program },
    diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined,
    usedAliases: new Set(),
    ...(state.names === false ? {} : { syntheticNames: createRustSyntheticNameState(ast, node, []) }),
    ...(state.counter === false ? {} : { controlFlow: { nextLoopId: 0 } }),
    moduleName: "index",
    structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(),
  };
}

function withHiddenField(program, view, field) {
  const ast = program.source.ast;
  const select = ast.as[view];
  const perturbed = {
    ...ast,
    as: {
      ...ast.as,
      [view]: node => {
        const selected = select(node);
        return selected === undefined ? undefined : { ...selected, [field]: undefined };
      },
    },
  };
  return { ...program, source: { ...program.source, ast: perturbed } };
}

function plannerFailure(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function assertPlannerInvariant(run, context, message, subject, label) {
  const failure = plannerFailure(run);
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT", label + ": typed planner invariant");
  assert.equal(failure.diagnostic.source, "tsonic-rust", label + ": Rust source");
  assert.equal(failure.diagnostic.category, "error", label + ": error category");
  assert.equal(failure.diagnostic.message, message, label + ": unchanged message");
  assert.equal(failure.diagnostic.sourceNode === subject, true, label + ": exact subject node");
  assert.equal(context.diagnostics.length, 0, label + ": no user diagnostic is pushed");
}

test("checked control-flow constructs plan normally with complete compiler state", () => {
  const program = analyzedProgram();
  const ifNode = findNode(program, (ast, node) => ast.is.IsIfStatement(node) && ast.is.IsBlock(ast.as.AsIfStatement(node)?.ThenStatement) && ast.statements(ast.as.AsIfStatement(node).ThenStatement).length === 0);
  const labeledNode = findNode(program, (ast, node) => ast.is.IsLabeledStatement(node));
  const doNode = findNode(program, (ast, node) => ast.is.IsDoStatement(node));
  const switchNode = findNode(program, (ast, node) => ast.is.IsSwitchStatement(node));
  for (const [label, node, plan] of [
    ["if", ifNode, planIfStatement],
    ["labeled block", labeledNode, planLabeledStatement],
    ["do-while", doNode, planDoStatement],
    ["switch", switchNode, planSwitchStatement],
  ]) {
    const context = planContext(program, node);
    const planned = plan(node, context);
    assert.equal(planned !== undefined && planned.length > 0, true, label + ": statements are planned");
    assert.equal(context.diagnostics.length, 0, label + ": no diagnostics");
  }
});

test("a missing mandatory if body is a planner invariant", () => {
  const program = analyzedProgram();
  const ifNode = findNode(program, (ast, node) => ast.is.IsIfStatement(node) && ast.is.IsBlock(ast.as.AsIfStatement(node)?.ThenStatement) && ast.statements(ast.as.AsIfStatement(node).ThenStatement).length === 0);
  const context = planContext(withHiddenField(program, "AsIfStatement", "ThenStatement"), ifNode);
  assertPlannerInvariant(() => planIfStatement(ifNode, context), context,
    "Control-flow construct has no source body statement.", context.sourceFile, "CF-01");
});

test("a labeled statement without its body or label is a planner invariant", () => {
  const program = analyzedProgram();
  const labeledNode = findNode(program, (ast, node) => ast.is.IsLabeledStatement(node));
  for (const field of ["Statement", "Label"]) {
    const context = planContext(withHiddenField(program, "AsLabeledStatement", field), labeledNode);
    assertPlannerInvariant(() => planLabeledStatement(labeledNode, context), context,
      "Labeled statements require exact label and body nodes.", labeledNode, "CF-02 without " + field);
  }
});

test("a do-while without its body or condition is a planner invariant", () => {
  const program = analyzedProgram();
  const doNode = findNode(program, (ast, node) => ast.is.IsDoStatement(node));
  for (const field of ["Statement", "Expression"]) {
    const context = planContext(withHiddenField(program, "AsDoStatement", field), doNode);
    assertPlannerInvariant(() => planDoStatement(doNode, context), context,
      "do-while requires concrete body and condition nodes.", doNode, "CF-03 without " + field);
  }
});

test("loop and break targets require the backend's own name and counter state", () => {
  const program = analyzedProgram();
  const doNode = findNode(program, (ast, node) => ast.is.IsDoStatement(node));
  for (const [label, create, message] of [
    ["CF-04 loop target", context => createRustLoopTarget(context, doNode, []),
      "Loop lowering requires finalized hygienic names and control-flow state."],
    ["CF-05 break target", context => createRustBreakTarget(context, doNode, "label"),
      "Labeled control flow requires finalized hygienic names and control-flow state."],
  ]) {
    const valid = planContext(program, doNode);
    const target = create(valid);
    assert.equal(target?.id === 0 && typeof target.label === "string" && target.label.length > 0, true, label + ": valid state allocates the first target");
    assert.equal(valid.controlFlow.nextLoopId, 1, label + ": the counter increments once on success");
    assert.equal(valid.diagnostics.length, 0, label + ": valid state has no diagnostics");
    for (const state of [{ names: false }, { counter: false }, { names: false, counter: false }]) {
      const context = planContext(program, doNode, state);
      const stateLabel = label + " without " + Object.keys(state).join(" and ");
      assertPlannerInvariant(() => create(context), context, message, context.sourceFile, stateLabel);
      if (context.controlFlow !== undefined) {
        assert.equal(context.controlFlow.nextLoopId, 0, stateLabel + ": the counter is unchanged");
      }
    }
  }
});

test("switch lowering requires the backend's own hygienic-name state", () => {
  const program = analyzedProgram();
  const switchNode = findNode(program, (ast, node) => ast.is.IsSwitchStatement(node));
  const context = planContext(program, switchNode, { names: false });
  assertPlannerInvariant(() => planSwitchStatement(switchNode, context), context,
    "Switch lowering requires finalized hygienic-name state.", switchNode, "CF-06");
});
