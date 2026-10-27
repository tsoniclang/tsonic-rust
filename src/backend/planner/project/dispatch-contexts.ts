import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustFinalizedDispatchContextInput } from "../../../target-model/records/operations/finalized-operation.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustDispatchContextProjection } from "../../../target-model/operations/dispatch-contexts.js";

export interface RustDispatchContextBinding {
  readonly name: string;
  readonly path: string;
}

export function projectRustDispatchContext(
  root: RustExpr,
  projections: readonly RustDispatchContextProjection[],
): RustExpr {
  return projections.reduce<RustExpr>((receiver, projection) => ({
    kind: "method-call", receiver, method: projection.name, args: [],
  }), root);
}

export function applyRustDispatchContextBindings(
  expression: RustExpr,
  bindings: readonly RustDispatchContextBinding[],
): RustExpr {
  let value = expression;
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding = bindings[index]!;
    value = {
      kind: "method-call", receiver: { kind: "path", path: binding.path }, method: "with",
      args: [{ kind: "closure", params: [{ name: binding.name, byRefCopy: false }], body: value }],
    };
  }
  return value;
}

export interface RustDispatchContextInputScope {
  input(input: RustFinalizedDispatchContextInput): RustExpr | undefined;
  apply(expression: RustExpr): RustExpr;
}

const emptyDispatchInputScope: RustDispatchContextInputScope = Object.freeze({
  input: () => undefined, apply: (expression: RustExpr) => expression,
});

export function planRustDispatchContextInputScope(
  inputs: readonly RustFinalizedDispatchContextInput[],
  operationNode: Node,
  context: RustPlanContext,
): RustDispatchContextInputScope | undefined {
  if (inputs.length === 0) return emptyDispatchInputScope;
  const program = context.input.program;
  const names = context.syntheticNames ?? createRustSyntheticNameState(program.source.ast, operationNode, []);
  const roots = new Map<string, { readonly name: string; readonly path: string }>();
  const values = new Map<RustFinalizedDispatchContextInput, RustExpr>();
  for (const input of inputs) {
    const selected = program.records.dispatchInput.get(context.sourcePackageComponentId, input);
    if (selected === undefined) return failRustPlannerInvariant("Native dispatch rendering requires its admitted exact component-owned input.", operationNode);
    const root = roots.get(selected.rootIdentity) ?? { name: allocateRustSyntheticName(names, "dispatch_root"), path: selected.path };
    roots.set(selected.rootIdentity, root);
    let value = projectRustDispatchContext({ kind: "path", path: root.name }, selected.projections);
    if (selected.handle !== undefined) {
      value = { kind: "method-call", receiver: value, method: selected.handle, args: [] };
      if (selected.reference) value = { kind: "reference", expr: value };
    }
    values.set(input, value);
  }
  const bindings = [...roots.values()].map(root => ({
    name: root.name, path: root.path,
  }));
  return {
    input: input => values.get(input),
    apply: expression => applyRustDispatchContextBindings(expression, bindings),
  };
}
