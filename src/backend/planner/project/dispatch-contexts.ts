import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustFinalizedDispatchContextInput } from "../../../analysis/facts/finalized-operation-abi.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
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

export function rustDispatchContextRootName(index: number): string {
  return `dispatch_root_${index + 1}`;
}

export function planRustDispatchContextInputScope(
  inputs: readonly RustFinalizedDispatchContextInput[],
  operationNode: Node,
  context: RustPlanContext,
): RustDispatchContextInputScope | undefined {
  if (inputs.length === 0) return emptyDispatchInputScope;
  const program = context.input.program;
  const demand = program.dispatchContextDemand.forComponent(context.sourcePackageComponentId);
  if (demand === undefined) return invalid("No exact component-owned dispatch demand was sealed.");
  const names = context.syntheticNames ?? createRustSyntheticNameState(program.source.ast, operationNode, []);
  const roots = new Map<string, string>();
  const values = new Map<RustFinalizedDispatchContextInput, RustExpr>();
  for (const input of inputs) {
    const declaration = program.dispatchContexts.declaration(input.source.contextId);
    const access = demand.access(input.source.contextId);
    const carrier = input.source.view === "root" ? declaration?.rootCarrier : declaration?.handleCarrier;
    if (declaration === undefined || access === undefined || carrier === undefined ||
      !demand.rootContextIds.includes(access.rootContextId) ||
      !rustTargetTypeRefEquals(input.carrier, carrier)) {
      return invalid("A native dispatch input has no matching exact declaration and demanded physical root.");
    }
    const rootName = roots.get(access.rootContextId) ?? allocateRustSyntheticName(names, "dispatch_root");
    roots.set(access.rootContextId, rootName);
    let value = projectRustDispatchContext({ kind: "path", path: rootName }, access.projections);
    if (input.source.view === "handle") {
      if (declaration.handle === undefined) return invalid("The selected native context has no scheduling handle projection.");
      value = { kind: "method-call", receiver: value, method: declaration.handle.name, args: [] };
      if (input.mode === "ref") value = { kind: "reference", expr: value };
    }
    values.set(input, value);
  }
  const bindings = [...roots].map(([rootContextId, name]) => ({
    name, path: `crate::${context.programModuleName}::${rustDispatchContextRootName(
      demand.rootContextIds.indexOf(rootContextId),
    )}`,
  }));
  return {
    input: input => values.get(input),
    apply: expression => applyRustDispatchContextBindings(expression, bindings),
  };

  function invalid(message: string): undefined {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode), "rust.backend.dispatch-context-input", message,
    ));
    return undefined;
  }
}
