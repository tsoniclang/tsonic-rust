import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function planRustCallableLeadingParameters(
  declaration: Node,
  context: RustPlanContext,
  nativeReceiver: { readonly name: string; readonly carrier: TargetTypeRef } | undefined,
) {
  const completion = context.input.program.records.callableLeading.get(declaration);
  if (completion === undefined) failRustPlannerInvariant("An admitted callable requires its native leading-parameter selection.", declaration);
  const selected = completion.parameters;
  if (selected.length > 0 && context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted callable leading parameter requires its native name scope.", declaration);
  const parameters = selected.filter(parameter => nativeReceiver === undefined || parameter.kind !== "this").map(parameter => ({ ...parameter, name: allocateRustSyntheticName(
    context.syntheticNames!, parameter.kind === "this" ? "_object_this" : "_object_receiver",
  ) }));
  const expressionOverrides = new Map(context.expressionOverrides ?? []);
  if (nativeReceiver !== undefined) for (const parameter of selected) {
    if (parameter.kind !== "this") continue;
    for (const node of parameter.reads) expressionOverrides.set(node, {
      carrier: parameter.carrier, valueForm: "storage", storageForm: "plain",
      expression: { kind: "dereference", pointer: { kind: "path", path: nativeReceiver.name } },
    });
  }
  for (const parameter of parameters) {
    for (const node of parameter.reads) expressionOverrides.set(node, {
      carrier: parameter.carrier, valueForm: "value", expression: { kind: "path", path: parameter.name },
    });
  }
  return { parameters, context: { ...context, expressionOverrides } };
}
