import type { Node } from "@tsonic/tsts";
import { isRustProgramErrorCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import type { RustProjectTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/types/value-projections.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectDispatchObjectType } from "./polymorphism/names.js";
import { rustStructuralViewInstance, rustStructuralViewRootType } from "./project-structural-roots.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export interface RustClosedNativeProjection {
  readonly expression: RustExpr;
  readonly recover: (owner: RustExpr) => RustExpr | undefined;
}

export function planRustClosedNativeProjection(
  node: Node,
  expression: RustExpr,
  evidence: RustProjectTypeTestPlan | Extract<RustFlowReadProjectionFact, { readonly kind: "closed-native" }>,
  context: RustPlanContext,
): RustClosedNativeProjection | undefined {
  if ("lowering" in evidence && evidence.lowering.kind !== "closed-native") {
    return undefined;
  }
  const sourceCarrier = evidence.sourceCarrier;
  const targetCarrier = "lowering" in evidence ? evidence.targetCarrier : evidence.selectedCarrier;
  const definition = context.input.program.projectTypes.definitionForCarrier(targetCarrier);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const type = rustTypeFromCarrierInContext(targetCarrier, context);
  if (representation === undefined || type?.kind !== "named") return undefined;
  const hierarchy = representation.kind === "open-hierarchy";
  const payload = representation.kind === "value" ? type : hierarchy
    ? rustProjectDispatchObjectType(targetCarrier, context)
    : rustStructuralViewRootType(targetCarrier, representation, context);
  if (payload === undefined) return undefined;
  const shared = representation.kind !== "value";
  const physical: RustType = shared ? { kind: "named", path: "alloc::rc::Rc",
    genericArguments: [{ kind: "type", type: payload }] } : payload;
  const query = (receiver: RustExpr): RustExpr => {
    if (isRustProgramErrorCarrier(rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier) &&
      rustCurrentErrorBoundary(context)?.errorDomain === "runtime") {
      return { kind: "path", path: "None", genericArguments: [{ kind: "type", type: physical }] };
    }
    return { kind: "method-call", receiver, method: shared ? "native_shared" : "native_value",
      genericArguments: [{ kind: "type", type: payload }], args: [] };
  };
  const optional = rustOptionElementCarrier(sourceCarrier);
  const name = optional === undefined ? undefined : allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "native_payload");
  const selected = name === undefined ? query(expression) : { kind: "method-call" as const,
    receiver: { kind: "method-call" as const, receiver: expression, method: "as_ref", args: [] },
    method: "and_then", args: [{ kind: "closure" as const, params: [{ name, byRefCopy: false }],
      body: query({ kind: "path", path: name }) }] };
  if (!shared) return { expression: selected, recover: owner => owner };
  if (hierarchy) {
    return { expression: selected, recover: owner => ({ kind: "struct-literal", path: type.path, fields: [
      { name: "identity", value: { kind: "method-call", receiver: {
        kind: "call", path: "rt::ObjectIdentityCarrier::object_identity", args: [
          { kind: "method-call", receiver: owner, method: "as_ref", args: [] },
        ],
      }, method: "clone", args: [] } },
      { name: "dispatch", value: owner },
    ] }) };
  }
  return { expression: selected,
    recover: owner => rustStructuralViewInstance(owner, targetCarrier, representation, context) };
}
