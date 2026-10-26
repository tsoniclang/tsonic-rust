import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import { rustProgramErrorTargetType } from "../../../../target-model/types/index.js";
import type { RustStructuralLiteralEmission } from "../../../../target-model/records/object-literal-emission.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import {
  emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustStructField, type RustType,
} from "../../../target-ast/syntax/nodes.js";
import { rustCurrentErrorBoundary, type RustPlanContext } from "../../program/plan-context.js";
import { rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import { allocateRustSyntheticTypeName, type RustSyntheticNameState } from "../../names/synthetic.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustStructuralDispatchType } from "../project-structural-types.js";
import { rustStructuralShapeGenerics, rustStructuralShapeContext } from "../structural-generics.js";
import { checkRustDataWrite } from "../data-writes.js";
import type { RustStructuralObjectFieldInitializer } from "../project-storage.js";
import { createRustStructuralObjectFromCarrier } from "../project-storage.js";
import { planNativeModuleFunction } from "../../declarations/callables/functions.js";
import { rustCallablePayloadContext } from "../../expressions/capture-payloads.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";

interface RustStructuralLiteralSlot {
  readonly name: string;
  readonly storageIndex: number;
  readonly role: "value" | "getter" | "setter";
}

export type RustStructuralLiteralImplementation = {
  readonly kind: "structural";
  readonly expression: Node;
  readonly items: readonly RustItem[];
} & ({
  readonly representation: "concrete";
  readonly carrier: TargetTypeRef;
} | {
  readonly representation: "dispatch";
  readonly wrapperPath: string;
  readonly stateName: string;
  readonly slots: readonly RustStructuralLiteralSlot[];
});

export function createStructuralLiteralImplementation(
  expression: Node, emission: RustStructuralLiteralEmission, context: RustPlanContext, names: RustSyntheticNameState,
): RustStructuralLiteralImplementation | undefined {
  const { shape, carrier } = emission;
  const instantiatedWrapper = rustTypeFromCarrierInContext(carrier, context);
  context = rustStructuralShapeContext(shape, context);
  const wrapper = rustTypeFromCarrierInContext(shape.carrier, context);
  if (shape.dispatchName === undefined) {
    const state = wrapper?.kind !== "named" || wrapper.genericArguments?.[0]?.kind !== "type" ? undefined : wrapper.genericArguments[0].type;
    if (state === undefined || shape.contextConstructor === undefined)
      failRustPlannerInvariant("A fixed structural literal requires its completed native state and immutable capture context.", expression);
    const substitutions = new Map(context.typeParameterSubstitutions);
    for (const parameter of shape.stateGenericParameters) if (parameter.kind === "type")
      substitutions.set(parameter.identity, { kind: "type-parameter", identity: parameter.identity, name: parameter.name });
    context = { ...context, typeParameterSubstitutions: substitutions };
    const boundLifetimes = new Set(shape.stateGenericParameters.flatMap(parameter =>
      parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
    const methods: RustImplFunction[] = [];
    for (const [storageIndex, field] of shape.fields.entries()) {
      const selected = field.methodPlan;
      if (selected?.kind !== "fixed") continue;
      const scope = createRustSyntheticNameState(context.input.program.source.ast, selected.declaration, []);
      const receiverName = allocateRustSyntheticName(scope, "object_receiver");
      const captures: RustExpr = { kind: "field", name: String(storageIndex),
        receiver: { kind: "method-call", receiver: { kind: "path", path: receiverName }, method: "context", args: [] } };
      const bodyContext = rustCallablePayloadContext(selected.payload, captures, context, "tuple");
      const planned = planNativeModuleFunction(selected.declaration, selected.declaration, field.targetName,
        bodyContext, { name: receiverName, carrier: shape.carrier, boundLifetimes, factoryReceiver: selected.factoryReceiver });
      methods.push({ ...planned.item, visibility: "public" },
        ...(planned.helper === undefined ? [] : [{ ...planned.helper, visibility: "public" as const }]));
    }
    return Object.freeze({ kind: "structural", representation: "concrete", expression, carrier,
      items: Object.freeze<RustItem[]>([{ kind: "impl", target: state,
        generics: rustStructuralShapeGenerics(shape, context, "state"), members: methods }]) });
  }
  const trait = rustStructuralDispatchType(shape.carrier, context);
  const errorType = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  if (wrapper?.kind !== "named" || instantiatedWrapper?.kind !== "named" || trait === undefined || errorType === undefined) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
  const stateName = allocateRustSyntheticTypeName(names, `${shape.targetName}Literal`);
  const generics = rustStructuralShapeGenerics(shape, context, "complete");
  const state: RustType = { kind: "named", path: stateName, genericArguments: wrapper.genericArguments };
  const root: RustType = { kind: "named", path: "rt::ObjectHandleState", genericArguments: [{ kind: "type", type: state }] };
  const fields: RustStructField[] = [];
  const slots: RustStructuralLiteralSlot[] = [];
  const functions: RustImplFunction[] = [];
  const selected = (name: string): RustExpr => ({ kind: "field", receiver: { kind: "path", path: "state" }, name });
  const read = (name: string, copy = false): RustExpr => ({ kind: "method-call", receiver: { kind: "path", path: "self" },
    method: "with", args: [{ kind: "closure", params: [{ name: "state", byRefCopy: false }],
      body: copy ? selected(name) : { kind: "method-call", receiver: selected(name), method: "clone", args: [] } }] });
  const receiver: RustExpr = { kind: "struct-literal", path: wrapper.path,
    fields: [{ name: "dispatch", value: { kind: "path", path: "self" } }] };
  const store = (name: string, storageIndex: number, role: RustStructuralLiteralSlot["role"], carrier: TargetTypeRef): boolean => {
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (type === undefined) return false;
    slots.push({ name, storageIndex, role });
    fields.push({ name, type, visibility: "crate" });
    return true;
  };
  for (const [storageIndex, selectedField] of emission.fields.entries()) {
    const { field } = selectedField;
    const accessor = selectedField.accessor;
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted structural literal field requires its exact native type.", expression);
    if (selectedField.method !== undefined) {
      const protocol = selectedField.method;
      const storage = protocol.storage;
      const result = rustTypeFromCarrierInContext(protocol.result, context);
      const params = protocol.parameters.map((carrier, index) => {
        const type = rustTypeFromCarrierInContext(carrier, context);
        return type === undefined ? undefined : { name: `argument${index}`, type };
      });
      if (result === undefined ||
        params.some(parameter => parameter === undefined) || !store(field.targetName, storageIndex, "value", storage)) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
      functions.push({ kind: "function", name: field.targetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("rc"), params: params as NonNullable<typeof params[number]>[], returnType: result, errorType,
        body: { statements: [{ kind: "let", name: "callable", mutable: false, init: read(field.targetName) }, { kind: "tail", expr: {
          kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call", args: [{ kind: "tuple-literal",
            elements: [...(field.methodPlan?.receiver === "independent" ? [] : [receiver]), ...params.map(parameter => ({ kind: "path" as const, path: parameter!.name }))] }],
        } }] } });
      continue;
    }
    const property = field.property;
    if (property === undefined) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
    let getter: RustExpr;
    let setter: RustExpr | undefined;
    if (accessor !== undefined) {
      if (!store(property.getterTargetName, storageIndex, "getter", accessor.getter)) failRustPlannerInvariant("An admitted structural literal requires its exact native getter storage.", expression);
      const call: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call",
        args: [{ kind: "tuple-literal", elements: [receiver] }] };
      getter = rustValueBlock([{ name: "callable", value: read(property.getterTargetName) }], field.presence === "required" ? call : {
        kind: "method-call", receiver: call, method: "map", args: [{ kind: "path", path: "Some" }],
      });
      if (property.setterTargetName !== undefined) {
        if (accessor.setter === undefined || !store(property.setterTargetName, storageIndex, "setter", accessor.setter)) failRustPlannerInvariant("An admitted structural literal requires its exact native setter storage.", expression);
        setter = rustValueBlock([{ name: "callable", value: read(property.setterTargetName) }], {
          kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call",
          args: [{ kind: "tuple-literal", elements: [receiver, { kind: "path", path: "value" }] }],
        });
      }
    } else {
      if (!store(field.targetName, storageIndex, "value", field.carrier)) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
      getter = { kind: "call", path: "Ok", args: [read(field.targetName, selectedField.copy)] };
      if (property.setterTargetName !== undefined) {
        let write: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with_mut", args: [{
          kind: "closure-block", params: [{ name: "state", mutable: false }], move: false, async: false,
          body: { statements: [{ kind: "assign", target: selected(field.targetName), operator: "=", value: { kind: "path", path: "value" } }] },
        }] };
        if (selectedField.frozen) {
          const owner = rustCurrentErrorBoundary(context);
          const checked = owner === undefined ? undefined
            : checkRustDataWrite("receiver", { kind: "path", path: "self" }, write, rustPackageFallibleBoundary(owner));
          if (checked === undefined) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
          write = checked;
        }
        setter = { kind: "evaluate-then", effect: write, discard: "unit", value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } };
      }
    }
    functions.push({ kind: "function", name: property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter(property.selfMode), params: [], returnType: type, errorType,
      body: { statements: [{ kind: "tail", expr: getter }] } });
    if (property.setterTargetName !== undefined) {
      if (setter === undefined) failRustPlannerInvariant("An admitted structural literal requires its exact native storage and accessor emission.", expression);
      functions.push({ kind: "function", name: property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter(property.selfMode), params: [{ name: "value", type }], returnType: { kind: "unit" }, errorType,
        body: { statements: [{ kind: "tail", expr: setter }] } });
    }
  }
  return Object.freeze({ kind: "structural", representation: "dispatch", expression, wrapperPath: instantiatedWrapper.path, stateName,
    slots: Object.freeze(slots), items: Object.freeze<RustItem[]>([
      { kind: "struct", name: stateName, visibility: "crate", generics, fields },
      { kind: "impl", target: root, trait, generics, members: functions },
    ]) });
}

export function constructRustStructuralLiteral(
  plan: RustStructuralLiteralImplementation, initializers: readonly RustStructuralObjectFieldInitializer[], context: RustPlanContext, identity?: RustExpr,
): RustExpr | undefined {
  if (plan.representation === "concrete") return createRustStructuralObjectFromCarrier(plan.carrier, initializers, context, identity);
  const fields = plan.slots.map(slot => {
    const initializer = initializers[slot.storageIndex];
    const value = slot.role === "value" ? initializer?.kind === "accessor" ? undefined : initializer?.value
      : initializer?.kind !== "accessor" ? undefined : slot.role === "getter" ? initializer.getter : initializer.setter;
    return value === undefined ? undefined : { name: slot.name, value };
  });
  if (fields.some(field => field === undefined)) failRustPlannerInvariant("An admitted structural literal requires its exact native field initializers.", plan.expression);
  return { kind: "struct-literal", path: plan.wrapperPath, fields: [{ name: "dispatch", value: {
    kind: "method-call", receiver: { kind: "call", path: identity === undefined ? "rt::ObjectHandle::new" : "rt::ObjectHandle::with_identity", args: [{ kind: "struct-literal",
      path: plan.stateName, fields: fields as NonNullable<typeof fields[number]>[] }, ...(identity === undefined ? [] : [identity])] }, method: "into_shared", args: [],
  } }] };
}
