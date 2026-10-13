import type { Node } from "@tsonic/tsts";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate, RustTypeBound } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustCallableGenericPlan } from "./generics.js";
import { rustErrorEffectsFactKey } from "../../../../analysis/facts/error-effects.js";
import { rustTargetTypeChildren } from "../../../../target-model/types/carriers/children.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustContextualValueConversionFactKey, rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";
import { rustNativeCallableInputPhysicalSignature } from "../../../../analysis/callables/native-conversions.js";
import { rustAsyncFunctionFactKey } from "../../../../analysis/facts/keys.js";

export function planRustNativeCallableGenerics(
  declaration: Node,
  source: RustCallableGenericPlan,
): RustCallableGenericPlan | undefined {
  const native = source.context.input.program.callableValues.native;
  const { nativeStorage } = source.context.input.program.callableValues;
  const environment = nativeStorage.futureEnvironmentFor(declaration);
  if (environment.kind === "unresolved") return undefined;
  const callableInputs = [...native.inputsFor(declaration), ...native.capturesFor(declaration)];
  const inputs = [...new Map([...callableInputs,
    ...environment.inputs, ...environment.captures]
    .map(input => [input.implementation.identity, input] as const)).values()];
  if (inputs.length === 0) return source;
  const sourceGenerics = source.finalizeGenerics();
  const typeParameterNames = new Map(source.context.typeParameterNames);
  const usedNames = new Set([...typeParameterNames.values(), ...sourceGenerics.parameters.map(parameter => parameter.name)]);
  for (const input of inputs) {
    if (source.context.typeParameterSubstitutions?.has(input.implementation.identity) === true) continue;
    typeParameterNames.set(input.implementation.identity, allocateRustGeneratedName(usedNames, input.implementation.name));
  }
  const context: RustPlanContext = { ...source.context, typeParameterNames };
  const bounds = new Map(inputs.map(input => [input.implementation.identity, new Map<string, TargetTypeRef>()]));
  for (const input of callableInputs)
    bounds.get(input.implementation.identity)!.set(closedMetadataKey(input.trait), input.trait);
  const visited = new Set<TargetTypeRef>();
  const collect = (type: TargetTypeRef): void => {
    if (visited.has(type)) return;
    visited.add(type);
    if (type.kind === "associated-type" && type.owner.kind === "type-parameter" && type.trait !== undefined)
      bounds.get(type.owner.identity)?.set(closedMetadataKey(type.trait), type.trait);
    for (const child of rustTargetTypeChildren(type)) collect(child);
  };
  if (context.input.program.facts.getFact(declaration, rustSourceCallableReturnFactKey) !== undefined) {
    const selected = nativeStorage.returnFor(declaration);
    if (selected.kind === "unresolved") return undefined;
    collect(selected.carrier);
  }
  let resolved = true;
  const visit = (node: Node): void => {
    if (!resolved) return;
    for (const error of context.input.program.facts.getFact(node, rustErrorEffectsFactKey)?.nativeErrors ?? [])
      collect(error.errorType);
    if (context.input.program.facts.getFact(node, rustContextualValueConversionFactKey)?.conversion.kind === "callable-adapter") {
      const selected = nativeStorage.valueFor(node);
      if (selected.kind === "unresolved") { resolved = false; return; }
      collect(selected.carrier);
    }
    const call = native.callFor(node);
    if (call !== undefined) bounds.get(call.input.implementation.identity)?.set(
      closedMetadataKey(call.input.trait), call.input.trait);
    context.input.program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(declaration);
  if (!resolved) return undefined;
  for (const forwarding of context.input.program.callableValues.nativeGenericProducers.forwardingFor(declaration)) {
    const selected = bounds.get(forwarding.input.implementation.identity);
    if (selected === undefined) return undefined;
    selected.set(closedMetadataKey(forwarding.trait), forwarding.trait);
  }
  const parameters: RustGenericParameter[] = [];
  const predicates: RustWherePredicate[] = [...sourceGenerics.wherePredicates];
  if (context.input.program.facts.getFact(declaration, rustAsyncFunctionFactKey)?.kind === "js-promise") {
    const errors = context.input.program.facts.getFact(declaration, rustErrorEffectsFactKey)?.nativeErrors ?? [];
    const selected = new Map(errors.map(error => [closedMetadataKey(error.errorType), error.errorType]));
    for (const carrier of selected.values()) {
      const type = rustTypeFromCarrierInContext(carrier, context);
      if (type === undefined) return undefined;
      predicates.push({ kind: "type", type, bounds: [{ kind: "trait", path: "core::clone::Clone" }] });
    }
  }
  for (const input of inputs) {
    const traits = [...bounds.get(input.implementation.identity)!.values()].map(trait => rustTypeFromCarrierInContext(trait, context));
    if (traits.some(trait => trait === undefined)) return undefined;
    const selectedBounds: RustTypeBound[] = traits.map(trait => ({ kind: "trait-type" as const, reference: { trait: trait! } }));
    const callableInput = callableInputs.find(selected => selected === input);
    const retained = callableInput === undefined ? [] : context.input.program.retainedCallableInputs.forInput(callableInput);
    if (retained.length > 0) {
      selectedBounds.push({ kind: "lifetime", lifetime: { kind: "static" } });
      const signature = callableInput !== undefined ? rustNativeCallableInputPhysicalSignature(callableInput, [],
        context.input.program.typeDefinitions) : undefined;
      const error = signature === undefined ? undefined : rustTypeFromCarrierInContext(signature.error, context);
      if (error === undefined) return undefined;
      for (const target of retained) {
        const type = rustTypeFromCarrierInContext(target, context);
        if (type === undefined) return undefined;
        predicates.push({ kind: "type", type: error, bounds: [{ kind: "trait-type", reference: {
          trait: { kind: "named", path: "core::convert::Into", genericArguments: [{ kind: "type", type }] },
        } }] });
      }
    }
    if (context.typeParameterSubstitutions?.has(input.implementation.identity) === true) {
      const type = rustTypeFromCarrierInContext(input.implementation, context);
      if (type === undefined) return undefined;
      if (selectedBounds.length > 0) predicates.push({ kind: "type", type, bounds: selectedBounds });
    } else parameters.push({ kind: "type", name: typeParameterNames.get(input.implementation.identity)!, bounds: selectedBounds });
  }
  const generics: RustGenerics = { parameters: [...sourceGenerics.parameters, ...parameters],
    wherePredicates: predicates };
  return { ...source, context, finalizeGenerics: () => generics };
}
