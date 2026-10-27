import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustNativeTaskScope, RustNativeTaskUse } from "../../../target-model/records/native/native-tasks.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustFunctionParam } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "./plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustSelectedErrorRegion } from "./error-regions.js";
import { planRustAwaitBranches } from "../expressions/await-completions.js";
import { planExpression } from "../expressions/entry.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

function scopeParameter(
  scope: RustNativeTaskScope,
  inputCarrier: TargetTypeRef,
  borrowed: boolean,
  context: RustPlanContext,
): { readonly parameter: RustFunctionParam; readonly context: RustPlanContext } {
  const type = rustTypeFromCarrierInContext(inputCarrier, context);
  if (type === undefined) failRustPlannerInvariant("An admitted native task input requires its selected physical scope type.");
  return {
    parameter: { name: scope.name, type },
    context: { ...context, nativeTaskScope: { scope, expression: { kind: "path", path: scope.name }, borrowed } },
  };
}

export function planRustNativeTaskOwner(
  declaration: Node,
  context: RustPlanContext,
): { readonly parameters: readonly RustFunctionParam[]; readonly context: RustPlanContext } {
  const selected = context.input.program.records.nativeTaskUse.get(declaration);
  if (selected === undefined) return { parameters: [], context: { ...context, nativeTaskScope: undefined } };
  if (selected.kind !== "owner") failRustPlannerInvariant("An admitted task-aware callable requires its sealed owner input.", declaration);
  const planned = scopeParameter(selected.scope, selected.inputCarrier, selected.binding === "borrowed-parameter", context);
  return { parameters: [planned.parameter], context: planned.context };
}

export function planRustNativeTaskInitializer(
  sourceFile: SourceFile,
  context: RustPlanContext,
): { readonly parameters: readonly RustFunctionParam[]; readonly context: RustPlanContext } {
  const selected = context.input.program.records.nativeTaskUse.get(sourceFile);
  if (selected === undefined) return { parameters: [], context: { ...context, nativeTaskScope: undefined } };
  if (selected.kind !== "entry") failRustPlannerInvariant("An admitted task-aware source entry requires its sealed initializer role.", sourceFile);
  if (selected.initializer === undefined) return { parameters: [], context: { ...context, nativeTaskScope: undefined } };
  const planned = scopeParameter(selected.scope, selected.initializer.inputCarrier, true, context);
  return { parameters: [planned.parameter], context: planned.context };
}

export function planRustNativeTaskCallArguments(node: Node, context: RustPlanContext): readonly RustExpr[] {
  const selected = context.input.program.records.nativeTaskUse.get(node);
  if (selected === undefined) return [];
  if (selected.kind !== "call") failRustPlannerInvariant("An admitted task-aware invocation requires its selected scope passing ABI.", node);
  const binding = context.nativeTaskScope;
  if (binding === undefined) failRustPlannerInvariant("An admitted native task call requires its active selected scope binding.", node);
  if (selected.passing === "borrow") return [binding.borrowed ? binding.expression : { kind: "reference", expr: binding.expression }];
  return [selected.passing === "move" ? binding.expression : { kind: "method-call", receiver: binding.expression, method: "clone", args: [] }];
}

export function planRustNativeTaskSpawn(
  node: Node,
  selected: Extract<RustNativeTaskUse, { readonly kind: "spawn" }>,
  context: RustPlanContext,
): RustExpr {
  const binding = context.nativeTaskScope;
  if (binding === undefined) failRustPlannerInvariant("An admitted native task spawn requires its active selected scope binding.", node);
  const initialization = context.input.program.records.programEmission.get()?.initialization;
  if (initialization === undefined) failRustPlannerInvariant("An admitted native task requires its sealed initialization and lifecycle plan.", node);
  const lifecycle = initialization.binary.lifecycle;
  const region = planRustSelectedErrorRegion(lifecycle.region, context, node);
  const errorType = rustTypeFromCarrierInContext(selected.scope.errorCarrier, context);
  if (region === undefined || errorType === undefined)
    failRustPlannerInvariant("An admitted native task requires its completed lifecycle error transport.", node);
  const future = planExpression(selected.operand, context);
  if (future === undefined) failRustPlannerInvariant("An admitted native task requires its exact future operand.", node);
  const names = context.syntheticNames
    ?? failRustPlannerInvariant("An admitted native task requires its native evaluation name scope.", node);
  const futureName = allocateRustSyntheticName(names, "native_task_future");
  const completion = planRustAwaitBranches(node, { kind: "path", path: futureName }, selected.completion, undefined, {
    ...context, fallibleBoundary: region.boundary, returnResult: { errorType },
    asyncContext: true, functionReturnType: { kind: "unit" },
    controlTargets: undefined, completionBoundary: undefined,
  });
  if (completion === undefined) failRustPlannerInvariant("An admitted native task requires its finalized discarded completion.", node);
  return { kind: "block", body: { statements: [
    { kind: "let", name: futureName, mutable: false, init: future },
    { kind: "tail", expr: { kind: "call", path: "tsonic_rust_runtime::spawn", args: [
    binding.borrowed ? binding.expression : { kind: "reference", expr: binding.expression },
    { kind: "async-block", move: true, body: { statements: [
      { kind: "expr", expr: completion },
      { kind: "tail", expr: { kind: "call", path: "Ok",
        genericArguments: [{ kind: "type", type: { kind: "unit" } }, { kind: "type", type: errorType }],
        args: [{ kind: "tuple-literal", elements: [] }] } },
    ] } },
    ] } },
  ] } };
}
