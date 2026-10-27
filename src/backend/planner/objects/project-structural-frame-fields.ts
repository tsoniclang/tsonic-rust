import type { Node } from "@tsonic/tsts";
import type { RustProjectStructuralView } from "../../../target-model/records/objects/project-structural-views.js";
import type { RustStructuralShapeField } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustImplFunction, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustErrorType } from "../program/fallible-boundaries.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustFrameBindingLocation } from "../bindings/frame-storage.js";
import { rustFrameOwnerReference, type RustLiveFrameOwner } from "../program/frame-owners.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustStructuralFrameField(
  declaration: Node, member: RustProjectStructuralView["fields"][number],
  field: RustStructuralShapeField, type: RustType, context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const binding = context.input.program.records.frameBindingDeclaration.get(member.declaration);
  const frame = context.input.program.records.frameOwner.get(declaration);
  const boundary = rustCurrentErrorBoundary(context);
  if (binding?.entry === undefined || frame?.storage.kind !== "object" || !frame.bindings.includes(binding) ||
    field.property?.selfMode !== "rc" || boundary === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted structural frame field requires its exact native entry, owner and accessor ABI.", member.declaration);
  const owner: RustLiveFrameOwner = { kind: "live", expression: { kind: "path", path: "self" }, borrowed: false,
    data: { kind: "object", mutable: frame.storage.mutable,
      name: allocateRustSyntheticName(context.syntheticNames, "frame_data") } };
  const location = rustFrameBindingLocation(binding, owner, context,
    { entryName: allocateRustSyntheticName(context.syntheticNames, "frame_entry") });
  const functions: RustImplFunction[] = [{
    kind: "function", name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
    selfParam: rustSelfParameter("rc"), params: [], returnType: type, errorType: rustErrorType(boundary),
    body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [location.read] } }] },
  }];
  if (field.property.setterTargetName !== undefined) {
    const value = { kind: "method-call" as const, receiver: { kind: "path" as const, path: "value" },
      method: "into_entry_for", args: [rustFrameOwnerReference(owner)] };
    const write = location.write(value, context);
    if (write === undefined) failRustPlannerInvariant("An admitted structural frame field requires its exact native write plan.", member.declaration);
    functions.push({
      kind: "function", name: field.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter("rc"), params: [{ name: "value", type }], returnType: { kind: "unit" },
      errorType: rustErrorType(boundary), body: { statements: [{ kind: "tail", expr: { kind: "evaluate-then",
        effect: write, discard: "unit", value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } } }] },
    });
  }
  return functions;
}
