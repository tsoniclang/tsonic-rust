import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableSignaturesMatch } from "../../target-model/conversions/generic-callable.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustSourceCallableReturnFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustNativeCallableInput, RustNativeCallableInputPlan } from "./native-inputs.js";

export type RustNativeStorageSelection =
  | { readonly kind: "identity"; readonly carrier: TargetTypeRef }
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeStoragePlan {
  returnFor(declaration: Node): RustNativeStorageSelection;
  valueFor(node: Node): RustNativeStorageSelection;
  subjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, owner?: Node): RustNativeStorageSelection;
  invocationReturnFor(implementation: Node, invocation: Node, owner?: Node): RustNativeStorageSelection;
  invocationInputFor(input: RustNativeCallableInput, invocation: Node, owner?: Node): RustNativeStorageSelection;
}

export function createRustNativeStoragePlan(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly facts: RustPlanQueries;
  readonly definitions: RustTypeDefinitions;
  readonly native: RustNativeCallableInputPlan;
}): RustNativeStoragePlan {
  const nodes = new Set(input.storage.nodes);
  const inputs = new Map(input.native.inputs.map(value => [value.subject, value]));
  const ownedInputs = new Set(input.native.inputs);
  const unresolved = (reason: string): Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }> =>
    Object.freeze({ kind: "unresolved", reason });
  const bindingsFor = (owner: Node | undefined): SourceStorageBindings | undefined => owner === undefined
    ? input.storage.emptyBindings : nodes.has(owner) ? input.native.bindingsFor(owner) : undefined;
  const ownerFor = (node: Node): Node | undefined => sourceEnclosingCallable(node, input.ast);
  const invocationBindingsFor = (implementation: Node, invocation: Node, owner?: Node): SourceStorageBindingsSelection => {
    if (!nodes.has(implementation) || !nodes.has(invocation))
      return unresolved("Native invocation storage requires its exact owned invocation and implementation.");
    if (input.facts.getFact(invocation, rustTargetOperationFactKey)?.kind !== "source-call")
      return unresolved("Native invocation storage has no finalized source call.");
    const parent = bindingsFor(owner ?? ownerFor(invocation));
    return parent === undefined ? unresolved("Native invocation storage has no exact caller bindings.")
      : input.storage.bindingsForInvocation(implementation, invocation, parent);
  };
  const select = (subject: SourceStorageSubject, carrier: TargetTypeRef,
    bindings: SourceStorageBindings | undefined): RustNativeStorageSelection => {
    if (bindings === undefined) return unresolved("Native callable storage has no exact declaration-local bindings.");
    const checked = input.storage.typeFor(subject);
    if (checked.kind === "unresolved") return checked;
    if (!isRustTargetTypeRef(carrier)) return unresolved("Native callable storage requires a valid selected carrier.");
    let remaining = 4096;
    let reason: string | undefined;
    const selectedInputs = new Set<RustNativeCallableInput>();
    const fail = (message: string): undefined => { reason ??= message; return undefined; };
    const step = (depth: number): boolean => {
      if (remaining-- > 0 && depth <= 128) return true;
      fail("Native callable storage exceeds its bounded carrier projection budget.");
      return false;
    };
    const containsCallable = (type: TargetTypeRef, depth: number, visited = new Set<TargetTypeRef>()): boolean | undefined => {
      if (!step(depth)) return undefined;
      if (visited.has(type)) return false;
      visited.add(type);
      if (rustCallableProtocol(type) !== undefined || rustGenericCallableValue(type) !== undefined) return true;
      const variants = input.definitions.sourceUnionVariants(type);
      for (const child of [...rustTargetTypeChildren(type), ...(variants?.map(variant => variant.carrier) ?? [])]) {
        const selected = containsCallable(child, depth + 1, visited);
        if (selected !== false) return selected;
      }
      return false;
    };
    const project = (subject: SourceStorageSubject, component: SourceStorageSubject["projection"][number]): SourceStorageSubject | undefined => {
      const selected = input.storage.subject(subject.node, subject.kind, [...subject.projection, component]);
      return selected.kind === "resolved" ? selected.subject : fail(selected.reason);
    };
    const visit = (current: TargetTypeRef, selectedSubject: SourceStorageSubject,
      depth: number, permitsAbsence: boolean): TargetTypeRef | undefined => {
      if (!step(depth)) return undefined;
      const optional = rustOptionElementCarrier(current);
      if (optional !== undefined) {
        const value = visit(optional, selectedSubject, depth + 1, true);
        if (value === undefined || value === optional) return value === undefined ? undefined : current;
        return current.kind === "type-parameter" ? rustSourceOptionalTargetType(value)
          : Object.freeze({ ...current, genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: value })]) });
      }
      if (current.kind === "reference") {
        const referent = visit(current.referent, selectedSubject, depth + 1, permitsAbsence);
        return referent === undefined ? undefined : referent === current.referent ? current : Object.freeze({ ...current, referent });
      }
      if (rustCallableProtocol(current) !== undefined || rustGenericCallableValue(current) !== undefined) {
        const origins = input.storage.boundOriginsFor(selectedSubject, bindings);
        if (origins.kind === "unresolved") return fail(origins.reason);
        let selected: RustNativeCallableInput | undefined;
        for (const origin of origins.subjects) {
          if (!step(depth)) return undefined;
          const candidate = inputs.get(origin);
          if (candidate === undefined) {
            const originCarrier = origin.projection.length === 0
              ? input.facts.getFact(origin.node, rustRuntimeCarrierKey)?.carrier : undefined;
            if (permitsAbsence && isRustAbsenceCarrier(originCarrier)) continue;
            return fail("Native callable storage has a producer without a sealed physical implementation.");
          }
          const candidateCarrier = callableValueCarrier(candidate.carrier);
          if (candidateCarrier === undefined || !sameCallableContract(current, candidateCarrier))
            return fail("Native callable storage conflicts with its exact input callable contract.");
          if (selected !== undefined && selected !== candidate)
            return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
          selected = candidate;
        }
        if (selected === undefined) return fail("Native callable storage has no selected physical input implementation.");
        selectedInputs.add(selected);
        return selected.implementation;
      }
      if (current.kind === "array" || current.kind === "slice") {
        const component = project(selectedSubject, { kind: "array-element" });
        const element = component === undefined ? undefined : visit(current.element, component, depth + 1, false);
        return element === undefined ? undefined : element === current.element ? current : Object.freeze({ ...current, element });
      }
      if (current.kind === "tuple") {
        const elements: TargetTypeRef[] = [];
        for (const [index, element] of current.elements.entries()) {
          const component = project(selectedSubject, { kind: "tuple-element", index });
          const selected = component === undefined ? undefined : visit(element, component, depth + 1, false);
          if (selected === undefined) return undefined;
          elements.push(selected);
        }
        return elements.every((element, index) => element === current.elements[index]) ? current
          : Object.freeze({ ...current, elements: Object.freeze(elements) });
      }
      const nested = containsCallable(current, depth + 1);
      return nested === undefined ? undefined : nested
        ? fail("Native callable storage requires its existing physical aggregate layout owner.") : current;
    };
    const physical = visit(carrier, subject, 0, false);
    return physical === undefined ? unresolved(reason ?? "Native callable storage has no exact physical selection.")
      : selectedInputs.size === 0 ? Object.freeze({ kind: "identity", carrier })
        : Object.freeze({ kind: "selected", carrier: physical, inputs: Object.freeze([...selectedInputs]) });
  };
  return Object.freeze({
    returnFor(declaration: Node): RustNativeStorageSelection {
      if (!nodes.has(declaration)) return unresolved("Native callable return requires an owned declaration.");
      const carrier = input.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
      if (carrier === undefined) return unresolved("Native callable return has no finalized logical carrier.");
      const subject = input.storage.subject(declaration, "return");
      return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindingsFor(declaration));
    },
    valueFor(node: Node): RustNativeStorageSelection {
      if (!nodes.has(node)) return unresolved("Native callable value requires an owned source node.");
      const carrier = input.facts.getFact(node, rustRuntimeCarrierKey)?.carrier;
      if (carrier === undefined) return unresolved("Native callable value has no finalized logical carrier.");
      const subject = input.storage.subjectFor(node);
      return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindingsFor(ownerFor(node)));
    },
    subjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, owner?: Node): RustNativeStorageSelection {
      const checked = input.storage.typeFor(subject);
      return checked.kind === "unresolved" ? checked : select(subject, carrier, bindingsFor(owner ?? ownerFor(subject.node)));
    },
    invocationReturnFor(implementation: Node, invocation: Node, owner?: Node): RustNativeStorageSelection {
      const bindings = invocationBindingsFor(implementation, invocation, owner);
      if (bindings.kind === "unresolved") return bindings;
      const operation = input.facts.getFact(invocation, rustTargetOperationFactKey);
      if (operation?.kind !== "source-call") return unresolved("Native invocation return has no finalized source call.");
      const subject = input.storage.subject(implementation, "return");
      return subject.kind === "unresolved" ? subject : select(subject.subject, operation.resultCarrier, bindings.bindings);
    },
    invocationInputFor(selected: RustNativeCallableInput, invocation: Node, owner?: Node): RustNativeStorageSelection {
      if (!ownedInputs.has(selected)) return unresolved("Native invocation input requires its exact owned input identity.");
      const bindings = invocationBindingsFor(selected.owner, invocation, owner);
      if (bindings.kind === "unresolved") return bindings;
      const signature = input.facts.getSelectedTargetCall(invocation);
      const operation = input.facts.getFact(invocation, rustTargetOperationFactKey);
      if (signature === undefined || operation?.kind !== "source-call")
        return unresolved("Native invocation input has no finalized selected signature.");
      const generics = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
      return generics === undefined ? unresolved("Native invocation input has no exact selected generic arguments.")
        : select(selected.subject, substituteRustTargetGenerics(selected.carrier, generics.types,
          generics.lifetimes, generics.consts), bindings.bindings);
    },
  });
}

function callableValueCarrier(carrier: TargetTypeRef): TargetTypeRef | undefined {
  let current = carrier;
  for (let depth = 0; depth <= 128; depth += 1) {
    const optional = rustOptionElementCarrier(current);
    if (optional !== undefined) current = optional;
    else if (current.kind === "reference") current = current.referent;
    else return current;
  }
  return undefined;
}

function sameCallableContract(left: TargetTypeRef, right: TargetTypeRef): boolean {
  if (rustGenericCallableValue(left) !== undefined || rustGenericCallableValue(right) !== undefined)
    return rustGenericCallableSignaturesMatch(left, right);
  const expected = rustCallableProtocol(left);
  const actual = rustCallableProtocol(right);
  return expected !== undefined && actual !== undefined &&
    expected.parameters.length === actual.parameters.length &&
    expected.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, actual.parameters[index])) &&
    rustTargetTypeRefEquals(expected.result, actual.result);
}
