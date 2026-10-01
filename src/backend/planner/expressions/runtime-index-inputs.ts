import type { Node } from "@tsonic/tsts";
import { sourceBindingHasMutableExposure, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";
import type { RustFinalizedOperationAbi } from "../../../analysis/facts/finalized-operation-abi.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";

export function planRustRuntimeIndexInputs(
  receiver: Node,
  index: Node,
  abi: RustFinalizedOperationAbi,
  prefix: string,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext;
} | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const borrowReceiver = abi.targetReceiver.kind === "input" &&
    abi.targetReceiver.input.mode === "ref" &&
    abi.targetReceiver.input.conversion.kind === "identity" &&
    receiverBindingIsStable(receiver, context);
  const overrides = new Map(context.expressionOverrides ?? []);
  const bindings: { name: string; value: RustExpr }[] = [];
  for (const [subject, suffix] of [[receiver, "receiver"], [index, "index"]] as const) {
    const borrowed = subject === receiver && borrowReceiver;
    const value = planExpression(subject, context, "value", borrowed ? "shared-reference" : "value");
    const carrier = effectivePlannedExpressionCarrier(subject, context);
    if (value === undefined || carrier === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, `${prefix}_${suffix}`);
    bindings.push({ name, value });
    overrides.set(subject, {
      expression: { kind: "path", path: name }, carrier,
      valueForm: borrowed ? "shared-reference" : "value",
    });
  }
  return { bindings, context: { ...context, expressionOverrides: overrides } };
}

function receiverBindingIsStable(receiver: Node, context: RustPlanContext): boolean {
  const { ast } = context.input.program.source;
  if (!ast.is.IsIdentifier(receiver)) return false;
  const navigation = context.input.program.sourceNavigation;
  const binding = navigation.referenceFor(receiver);
  if (binding === undefined || sourceDeclarationIsModuleScoped(binding.declaration, ast)) return false;
  const summary = navigation.declarationUseSummary(binding.declaration);
  if (summary.bindingWritten || summary.exported) return false;
  let remaining = 2_048;
  return !sourceBindingHasMutableExposure({ ast, sourceFacts: { getFact: context.input.program.facts.get } },
    summary, () => --remaining >= 0);
}
