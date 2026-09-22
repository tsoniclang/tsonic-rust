import type { Node } from "@tsonic/tsts";
import { isRustCopyCarrier, rustCallableProtocol, rustCallableTargetType,
  rustProgramErrorTargetType, rustStructuralMethodStorageCarrier,
  rustStructuralPropertyValueCarrier, rustUnitTargetType } from "../../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustStructField,
  type RustType } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { allocateRustSyntheticTypeName, type RustSyntheticNameState } from "../../names/synthetic.js";
import { rustSelfParameter } from "../../declarations/self-parameter.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustStructuralDispatchType } from "../project-structural-views.js";
import { rustStructuralShapeGenerics } from "../structural-generics.js";
import { checkRustDataWrite } from "../data-writes.js";
import type { RustStructuralObjectFieldInitializer } from "../project-storage.js";

interface RustStructuralLiteralSlot {
  readonly name: string;
  readonly storageIndex: number;
  readonly role: "value" | "getter" | "setter";
}

export interface RustStructuralLiteralImplementation {
  readonly kind: "structural";
  readonly expression: Node;
  readonly wrapperPath: string;
  readonly stateName: string;
  readonly slots: readonly RustStructuralLiteralSlot[];
  readonly items: readonly RustItem[];
}

export function createStructuralLiteralImplementation(
  expression: Node, carrier: TargetTypeRef, accessorFields: ReadonlySet<number>, context: RustPlanContext, names: RustSyntheticNameState,
): RustStructuralLiteralImplementation | undefined {
  const instance = context.input.program.structuralShapes.definitionForCarrier(carrier);
  const shape = context.input.program.structuralShapes.definitions.find(candidate =>
    candidate.targetName === instance?.targetName && candidate.componentId === instance.componentId);
  if (shape?.dispatchName === undefined || shape.construction !== undefined) return undefined;
  const wrapper = rustTypeFromCarrierInContext(shape.carrier, context);
  const instantiatedWrapper = rustTypeFromCarrierInContext(carrier, context);
  const trait = rustStructuralDispatchType(shape.carrier, context);
  const errorType = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  if (wrapper?.kind !== "named" || instantiatedWrapper?.kind !== "named" || trait === undefined || errorType === undefined) return undefined;
  const stateName = allocateRustSyntheticTypeName(names, `${shape.targetName}Literal`);
  const generics = rustStructuralShapeGenerics(shape, context);
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
  for (const [storageIndex, field] of shape.fields.entries()) {
    const accessor = accessorFields.has(storageIndex);
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined || field.nativeLayout !== undefined || field.storage === "bound") return undefined;
    if (field.method) {
      const protocol = rustCallableProtocol(field.carrier);
      const storage = field.receiverIndependent ? field.carrier
        : rustStructuralMethodStorageCarrier(shape.carrier, field.carrier, field.presence);
      const result = protocol === undefined ? undefined : rustTypeFromCarrierInContext(protocol.result, context);
      const params = protocol?.parameters.map((carrier, index) => {
        const type = rustTypeFromCarrierInContext(carrier, context);
        return type === undefined ? undefined : { name: `argument${index}`, type };
      });
      if (protocol === undefined || storage === undefined || result === undefined || params === undefined ||
        params.some(parameter => parameter === undefined) || !store(field.targetName, storageIndex, "value", storage)) return undefined;
      functions.push({ name: field.targetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("rc"), params: params as NonNullable<typeof params[number]>[], returnType: result, errorType,
        body: { statements: [{ kind: "let", name: "callable", mutable: false, init: read(field.targetName) }, { kind: "tail", expr: {
          kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call", args: [{ kind: "tuple-literal",
            elements: [...(field.receiverIndependent ? [] : [receiver]), ...params.map(parameter => ({ kind: "path" as const, path: parameter!.name }))] }],
        } }] } });
      continue;
    }
    const property = field.property;
    if (property === undefined) return undefined;
    let getter: RustExpr;
    let setter: RustExpr | undefined;
    if (accessor) {
      const valueCarrier = rustStructuralPropertyValueCarrier(field.carrier, field.presence);
      if (valueCarrier === undefined || property.selfMode !== "rc" ||
        !store(property.getterTargetName, storageIndex, "getter", rustCallableTargetType([shape.carrier], valueCarrier))) return undefined;
      const call: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call",
        args: [{ kind: "tuple-literal", elements: [receiver] }] };
      getter = { kind: "block", bindings: [{ name: "callable", value: read(property.getterTargetName) }], value: field.presence === "required" ? call : {
        kind: "method-call", receiver: call, method: "map", args: [{ kind: "path", path: "Some" }],
      } };
      if (property.setterTargetName !== undefined) {
        if (field.presence !== "required" || !store(property.setterTargetName, storageIndex, "setter",
          rustCallableTargetType([shape.carrier, valueCarrier], rustUnitTargetType()))) return undefined;
        setter = { kind: "block", bindings: [{ name: "callable", value: read(property.setterTargetName) }], value: {
          kind: "method-call", receiver: { kind: "path", path: "callable" }, method: "call",
          args: [{ kind: "tuple-literal", elements: [receiver, { kind: "path", path: "value" }] }],
        } };
      }
    } else {
      if (!store(field.targetName, storageIndex, "value", field.carrier)) return undefined;
      getter = { kind: "call", path: "Ok", args: [read(field.targetName, isRustCopyCarrier(field.carrier))] };
      if (property.setterTargetName !== undefined) {
        let write: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with_mut", args: [{
          kind: "closure-block", params: [{ name: "state", mutable: false }], move: false, async: false,
          body: { statements: [{ kind: "assign", target: selected(field.targetName), operator: "=", value: { kind: "path", path: "value" } }] },
        }] };
        const freeze = context.input.program.frozenDataWrites.receiverFor("structural-object", carrier, storageIndex);
        if (freeze !== undefined) write = checkRustDataWrite("receiver", { kind: "path", path: "self" }, write, errorType);
        setter = { kind: "evaluate-then", effect: write, discard: "unit", value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } };
      }
    }
    functions.push({ name: property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
      selfParam: rustSelfParameter(property.selfMode), params: [], returnType: type, errorType,
      body: { statements: [{ kind: "tail", expr: getter }] } });
    if (property.setterTargetName !== undefined) {
      if (setter === undefined) return undefined;
      functions.push({ name: property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter(property.selfMode), params: [{ name: "value", type }], returnType: { kind: "unit" }, errorType,
        body: { statements: [{ kind: "tail", expr: setter }] } });
    }
  }
  return Object.freeze({ kind: "structural", expression, wrapperPath: instantiatedWrapper.path, stateName,
    slots: Object.freeze(slots), items: Object.freeze<RustItem[]>([
      { kind: "struct", name: stateName, visibility: "crate", generics, derives: [], fields },
      { kind: "impl", target: root, trait, generics, functions },
    ]) });
}

export function constructRustStructuralLiteral(
  plan: RustStructuralLiteralImplementation, initializers: readonly RustStructuralObjectFieldInitializer[], identity?: RustExpr,
): RustExpr | undefined {
  const fields = plan.slots.map(slot => {
    const initializer = initializers[slot.storageIndex];
    const value = slot.role === "value" ? initializer?.kind === "accessor" ? undefined : initializer?.value
      : initializer?.kind !== "accessor" ? undefined : slot.role === "getter" ? initializer.getter : initializer.setter;
    return value === undefined ? undefined : { name: slot.name, value };
  });
  if (fields.some(field => field === undefined)) return undefined;
  return { kind: "struct-literal", path: plan.wrapperPath, fields: [{ name: "dispatch", value: {
    kind: "method-call", receiver: { kind: "call", path: identity === undefined ? "rt::ObjectHandle::new" : "rt::ObjectHandle::with_identity", args: [{ kind: "struct-literal",
      path: plan.stateName, fields: fields as NonNullable<typeof fields[number]>[] }, ...(identity === undefined ? [] : [identity])] }, method: "into_shared", args: [],
  } }] };
}
