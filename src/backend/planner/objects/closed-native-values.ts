import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/objects/value-projections.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectDispatchObjectType } from "./polymorphism/names.js";
import { rustStructuralViewInstance, rustStructuralViewRootType } from "./project-structural-roots.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustAutoBorrowedReceiver } from "../expressions/auto-borrowed-receivers.js";

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
  const sourceCarrier = evidence.sourceCarrier;
  const targetCarrier = "lowering" in evidence ? evidence.targetCarrier : evidence.selectedCarrier;
  const selected = context.input.program.records.closedNativeProjection.get(node, sourceCarrier, targetCarrier, context.errorDomain);
  if (selected === undefined) failRustPlannerInvariant("An admitted closed native projection requires its sealed physical query and recovery plan.", node);
  const representation = selected.representation;
  const type = rustTypeFromCarrierInContext(targetCarrier, context);
  if (type?.kind !== "named") failRustPlannerInvariant("An admitted closed native projection requires its named native target carrier.", node);
  const hierarchy = selected.payload === "dispatch";
  const payload = selected.payload === "value" ? type : hierarchy
    ? rustProjectDispatchObjectType(targetCarrier, context)
    : rustStructuralViewRootType(targetCarrier, representation, context);
  if (payload === undefined) failRustPlannerInvariant("An admitted closed native projection requires its native payload type.", node);
  const shared = selected.payload !== "value";
  const physical: RustType = shared ? { kind: "named", path: "alloc::rc::Rc",
    genericArguments: [{ kind: "type", type: payload }] } : payload;
  const query = (receiver: RustExpr): RustExpr => {
    if (selected.query === "none") {
      return { kind: "path", path: "None", genericArguments: [{ kind: "type", type: physical }] };
    }
    return { kind: "method-call", receiver: rustAutoBorrowedReceiver(receiver), method: selected.query,
      genericArguments: [{ kind: "type", type: payload }], args: [] };
  };
  const name = !selected.optional ? undefined : allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "native_payload");
  const projected = name === undefined ? query(expression) : { kind: "method-call" as const,
    receiver: { kind: "method-call" as const, receiver: rustAutoBorrowedReceiver(expression), method: "as_ref", args: [] },
    method: "and_then", args: [{ kind: "closure" as const, params: [{ name, byRefCopy: false }],
      body: query({ kind: "path", path: name }) }] };
  if (!shared) return { expression: projected, recover: owner => owner };
  if (hierarchy) {
    return { expression: projected, recover: owner => ({ kind: "struct-literal", path: type.path, fields: [
      { name: "identity", value: { kind: "method-call", receiver: {
        kind: "call", path: "rt::ObjectIdentityCarrier::object_identity", args: [
          { kind: "method-call", receiver: owner, method: "as_ref", args: [] },
        ],
      }, method: "clone", args: [] } },
      { name: "dispatch", value: owner },
    ] }) };
  }
  return { expression: projected,
    recover: owner => rustStructuralViewInstance(owner, targetCarrier, representation, context) };
}
