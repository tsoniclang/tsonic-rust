import type { Node } from "@tsonic/tsts";
import type { RustInitializerSelection, RustLifecycleErrorSelection } from "../../../target-model/records/errors/error-regions.js";
import type { RustNativeTaskUse } from "../../../target-model/records/native/native-tasks.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustSelectedErrorRegion } from "./error-regions.js";
import { planRustInitializerLifecycleResult } from "./initializer-lifecycle.js";
import { planRustInitializerBoundary, type RustCrateInitializer, type RustModuleInitializer } from "./module-initialization.js";

export function planRustNativeTaskEntry(input: {
  readonly sourceNode: Node | undefined;
  readonly task: Extract<RustNativeTaskUse, { readonly kind: "entry" }>;
  readonly initialization: RustInitializerSelection;
  readonly initializer: RustCrateInitializer;
  readonly modules: readonly RustModuleInitializer[];
  readonly lifecycle: RustLifecycleErrorSelection;
  readonly lifecycleType: RustType;
  readonly rendering: RustTypeRenderingContext;
  readonly crateName: string;
}): RustExpr {
  const args: readonly RustExpr[] = input.task.initializer === undefined ? []
    : [{ kind: "reference", expr: { kind: "path", path: input.task.scope.name } }];
  const call: RustExpr = { kind: "call", path: `${input.crateName}::${input.initializer.functionName}`, args };
  const execution: RustExpr = input.initializer.asynchronous ? { kind: "await", expr: call } : call;
  let initialize: RustExpr = execution;
  if (input.initialization.error.kind !== "infallible") {
    const operand = planRustInitializerBoundary(input.initialization, input.modules, input.initializer.functionName,
      input.initializer.errorJoinName, input.rendering, input.crateName);
    const lifecycle = planRustSelectedErrorRegion(input.lifecycle.region, input.rendering, input.sourceNode, undefined, input.crateName)?.boundary;
    if (operand === undefined || lifecycle === undefined)
      failRustPlannerInvariant("An admitted native task entry requires its exact initializer-to-lifecycle error transport.");
    initialize = { kind: "try", operandErrorType: lifecycle.errorType, resultErrorType: lifecycle.errorType,
      expr: planRustInitializerLifecycleResult(input.initialization.error, operand, lifecycle, execution) };
  }
  const statements: readonly RustStmt[] = [
    { kind: "expr", expr: initialize },
    { kind: "tail", expr: { kind: "call", path: "Ok",
      genericArguments: [{ kind: "type", type: { kind: "unit" } }, { kind: "type", type: input.lifecycleType }],
      args: [{ kind: "tuple-literal", elements: [] }] } },
  ];
  return { kind: "call", path: "tsonic_rust_runtime::run_tasks", args: [{
    kind: "closure-block", params: [{ name: input.task.scope.name }], move: true, async: true, body: { statements },
  }] };
}
