import type {
  RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallableImplementation,
} from "../../../../target-model/records/callables/frame-callables.js";

import type { RustExpr, RustGenerics, RustItem, RustPattern, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { planRustSelectedErrorRegion } from "../../program/error-regions.js";
import { planRustSelectedSourceErrorPropagation } from "../../expressions/calls/source-errors.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { rustFrameCallableTypes, renderRustFrameNativeType } from "../../types/frame-callables.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { isRustUnitCarrier } from "../../../../target-model/types/carriers/js.js";
import { rustCallablePayloadContext, rustCallablePayloadTypes } from "../../expressions/capture-payloads.js";
import { rustFrameBindingContext, rustFrameBindingType } from "../../bindings/frame-storage.js";
import { planNativeModuleFunction } from "./functions.js";
import { genericCallableCopyStateItems } from "./generic-storage.js";
import { rustSelfParameter } from "./self-parameter.js";
import { rustInvariantTypeMarker } from "../../types/invariant-marker.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import type { RustFrameDefinitionEmission } from "../../../../target-model/records/callables/frame-emission.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import type { RustLiveFrameOwner } from "../../program/frame-owners.js";
import { planRustFrameCallableFamilyItems } from "./frame-family-implementations.js";

function shared(type: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}

function definitionContext(definition: RustFrameCallableDefinition, context: RustPlanContext): RustPlanContext {
  return rustGeneratedTypeParameterContext(definition.environmentParameters, [],
    { ...context, callableDeclaration: definition.activation.ownerDeclaration });
}

function definitionGenerics(definition: RustFrameCallableDefinition, context: RustPlanContext): RustGenerics {
  const emission = context.input.program.records.frameDeclaration.get(definition);
  if (emission === undefined) failRustPlannerInvariant("An admitted frame requires its sealed generic emission contract.", definition.activation.ownerDeclaration);
  return rustGenericsWithAssociatedBounds(emission.parameters.map(parameter => ({
    kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
    bounds: rustGenericRequirementBounds(parameter.requirements),
  })), [...rustAssociatedPredicates(emission.associated, context),
    ...rustProjectProjectionPredicates(emission.projections, context)]);
}

function definitionMarker(generics: RustGenerics): RustType | undefined {
  const parameters = generics.parameters.filter(parameter => parameter.kind === "type")
    .map(parameter => ({ kind: "named" as const, path: parameter.name }));
  return parameters.length === 0 ? undefined : rustInvariantTypeMarker(parameters);
}

function entryHasPayload(implementation: RustFrameCallableImplementation, emission: RustFrameDefinitionEmission): boolean {
  const payload = emission.payloads.get(implementation);
  if (payload === undefined) failRustPlannerInvariant("An admitted native frame member requires its selected payload layout.", implementation.declaration);
  return payload;
}

function stateType(implementation: RustFrameCallableImplementation, generics: RustGenerics): RustType {
  return { kind: "named", path: implementation.stateName, genericArguments: generics.parameters
    .filter(parameter => parameter.kind === "type").map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })) };
}

function entryClone(
  entry: RustFrameCallableEntryDefinition, target: RustType, generics: RustGenerics, emission: RustFrameDefinitionEmission,
): readonly RustItem[] {
  if (entry.copy) return genericCallableCopyStateItems(target, generics);
  return [{ kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, members: [{
    kind: "function", name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: [
        ...entry.implementations.filter(implementation => !implementation.independent).map((implementation):
          Extract<RustExpr, { readonly kind: "match" }>["arms"][number] => ({
        pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
          { kind: "binding", name: "identity" }, ...(!entryHasPayload(implementation, emission) ? [] : [{ kind: "binding" as const, name: "state" }]),
        ] },
        expression: { kind: "call", path: `Self::${implementation.variantName}`, args: [
          { kind: "dereference", pointer: { kind: "path", path: "identity" } },
          ...(!entryHasPayload(implementation, emission) ? [] : [implementation.copy
            ? { kind: "dereference" as const, pointer: { kind: "path" as const, path: "state" } }
            : { kind: "method-call" as const, receiver: { kind: "path" as const, path: "state" }, method: "clone", args: [] }]),
        ] },
      })), ...(entry.hasIndependent ? [{
        pattern: { kind: "tuple-variant" as const, path: "Self::Independent", elements: [{ kind: "binding" as const, name: "value" }] },
        expression: { kind: "call" as const, path: "Self::Independent", args: [
          { kind: "method-call" as const, receiver: { kind: "path" as const, path: "value" }, method: "clone", args: [] },
        ] },
      }] : [])],
    } }] },
  }] }];
}

function entryEquality(entry: RustFrameCallableEntryDefinition, target: RustType, generics: RustGenerics, emission: RustFrameDefinitionEmission): readonly RustItem[] {
  const pattern = (implementation: RustFrameCallableImplementation, name: string): RustPattern => ({
    kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "binding", name }, ...(!entryHasPayload(implementation, emission) ? [] : [{ kind: "wildcard" as const }]),
    ],
  });
  return [{ kind: "impl", trait: { kind: "named", path: "PartialEq" }, target, generics, members: [{
    kind: "function", name: "eq", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [{ name: "other", type: { kind: "reference", referent: { kind: "named", path: "Self" }, mutable: false } }],
    returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "tuple-literal", elements: [{ kind: "path", path: "self" }, { kind: "path", path: "other" }] },
      arms: [...entry.implementations.filter(implementation => !implementation.independent).map(implementation => ({
        pattern: { kind: "tuple" as const, elements: [pattern(implementation, "left"), pattern(implementation, "right")] },
        expression: { kind: "binary" as const, operator: "==" as const,
          left: { kind: "path" as const, path: "left" }, right: { kind: "path" as const, path: "right" } },
      })), ...(entry.hasIndependent ? [{
        pattern: { kind: "tuple" as const, elements: ["left", "right"].map(name => ({
          kind: "tuple-variant" as const, path: "Self::Independent", elements: [{ kind: "binding" as const, name }],
        })) },
        expression: { kind: "binary" as const, operator: "==" as const,
          left: { kind: "path" as const, path: "left" }, right: { kind: "path" as const, path: "right" } },
      }] : []), ...(entry.implementations.length <= 1 && !entry.hasIndependent ? [] : [{
        pattern: { kind: "wildcard" as const }, expression: { kind: "bool-literal" as const, value: false },
      }])],
    } }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "Eq" }, target, generics, members: [] }];
}

function planFrameEntry(
  definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition, context: RustPlanContext,
): readonly RustItem[] | undefined {
  const emission = context.input.program.records.frameDeclaration.get(definition);
  if (emission === undefined) failRustPlannerInvariant("An admitted native frame requires its selected emission metadata.", definition.activation.ownerDeclaration);
  const carrier = entry.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  const errors = emission.errors.get(entry);
  const errorType = errors === undefined ? undefined : rustTypeFromCarrierInContext(errors.carrier, context);
  if (types === undefined || errors === undefined || errorType === undefined)
    failRustPlannerInvariant("An admitted native frame requires its complete storage and invocation error syntax.", definition.activation.ownerDeclaration);
  const boundary = planRustSelectedErrorRegion(errors.region, context, definition.activation.ownerDeclaration);
  if (boundary === undefined) failRustPlannerInvariant("An admitted native frame requires its selected invocation error region.", definition.activation.ownerDeclaration);
  const entryContext = { ...context, fallibleBoundary: boundary.boundary };
  const generics = definitionGenerics(definition, context);
  const items: RustItem[] = [];
  const variants: Extract<RustItem, { readonly kind: "enum" }>["variants"][number][] = [];
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  let argumentTypes: readonly RustType[] | undefined;
  let resultType: RustType | undefined;
  for (const implementation of entry.implementations) {
    if (implementation.independent) continue;
    const callable = context.input.program.records.callableDeclaration.get(implementation.declaration);
    if (callable === undefined || callable.nativeAsync) failRustPlannerInvariant("An admitted frame entry requires its synchronous native invocation contract.", implementation.declaration);
    const nativeEntry = context.input.program.records.callableLeading.get(implementation.declaration)?.frameEntries.get(implementation);
    if (nativeEntry?.type.definition !== definition || nativeEntry.type.entry !== entry)
      failRustPlannerInvariant("An admitted native frame helper requires its exact early physical entry.", implementation.declaration);
    const suspended = nativeEntry.suspended;
    const nativeTypes = renderRustFrameNativeType(nativeEntry.type, context);
    const state = stateType(implementation, generics);
    const captures = rustCallablePayloadTypes(implementation, context);
    if (captures === undefined) failRustPlannerInvariant("An admitted native frame requires its complete storage and callable syntax.", definition.activation.ownerDeclaration);
    const marker = definitionMarker(generics);
    if (captures.length !== 0 || marker !== undefined) {
      items.push({ kind: "struct", name: implementation.stateName, visibility: "public", generics,
        fields: [...(captures as RustType[]).map((type, index) => ({ name: `capture_${index}`, type, visibility: "public" as const })),
          ...(marker === undefined ? [] : [{ name: "marker", type: marker, visibility: "public" as const }])] });
      if (implementation.copy) items.push(...genericCallableCopyStateItems(state, generics));
    }
    const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
    const frameName = allocateRustSyntheticName(names, "frame_owner");
    const stateName = allocateRustSyntheticName(names, "frame_state");
    const owner: RustLiveFrameOwner = { kind: "live", expression: { kind: "path", path: frameName }, borrowed: !suspended,
      data: definition.storage.kind === "standalone" ? { kind: "direct" }
        : { kind: "object", mutable: definition.storage.mutable, name: allocateRustSyntheticName(names, "frame_data") } };
    const helperContext = rustFrameBindingContext(definition, owner,
      rustCallablePayloadContext(implementation, { kind: "path", path: stateName },
        { ...context, nativeHeaderPlacement: implementation, nativeHeaderParent: undefined }, "named"));
    const planned = planNativeModuleFunction(implementation.declaration, implementation.declaration,
      implementation.functionName, helperContext, undefined);
    const helpers = planned.helper === undefined ? [planned.item] : [planned.item, planned.helper];
    argumentTypes ??= callable.parameterCarriers.map(carrier => rustTypeFromCarrierInContext(carrier, context)
      ?? failRustPlannerInvariant("An admitted frame entry requires its renderable native argument ABI.", implementation.declaration));
    const fallible = callable.resultWrapped;
    const output: RustType = { kind: "named", path: "Result", genericArguments: [
      { kind: "type" as const, type: rustTypeFromCarrierInContext(callable.resultCarrier, context)
        ?? failRustPlannerInvariant("An admitted frame entry requires its renderable native completion ABI.", implementation.declaration) },
      { kind: "type" as const, type: errorType },
    ] };
    resultType ??= output;
    items.push(...helpers.map((helper): RustItem => ({ ...helper, generics, params: [
      { name: frameName, type: nativeEntry.ownerPassing === "rc" ? shared(nativeTypes.frameType)
        : { kind: "reference", referent: shared(nativeTypes.frameType), mutable: false } },
      ...(nativeEntry.statePassing === undefined ? [] : [{ name: stateName, type: nativeEntry.statePassing === "value" ? state
        : nativeEntry.statePassing === "rc" ? shared(state) : { kind: "reference" as const, referent: state, mutable: false } }]),
      ...helper.params,
    ] })));
    variants.push({ name: implementation.variantName, fields: [{ kind: "primitive", name: "usize" },
      ...(!entryHasPayload(implementation, emission) ? [] : [implementation.copy ? state : shared(state)])] });
    const call: RustExpr = { kind: "call", path: implementation.functionName, args: [
      suspended ? { kind: "call", path: "alloc::rc::Rc::clone", args: [{ kind: "path", path: "frame" }] }
        : { kind: "path", path: "frame" },
      ...(captures.length === 0 ? [] : [!suspended ? { kind: "path" as const, path: "state" }
        : implementation.copy ? { kind: "dereference" as const, pointer: { kind: "path" as const, path: "state" } }
          : { kind: "call" as const, path: "alloc::rc::Rc::clone", args: [{ kind: "path" as const, path: "state" }] }]),
      ...callable.parameterCarriers.map((_parameter, index) => ({ kind: "field" as const,
        receiver: { kind: "path" as const, path: "arguments" }, name: String(index) })),
    ] };
    const transport = errors.implementations.get(implementation);
    if (transport === undefined) failRustPlannerInvariant("An admitted frame implementation requires its selected invocation error transport.", implementation.declaration);
    const mapped = transport.kind !== "mapped" ? undefined : planRustSelectedSourceErrorPropagation(implementation.declaration,
      { ...transport.transport, channels: new Map(transport.transport.channels.map(channel => [channel.sourceIdentity,
        { targetIdentity: channel.targetIdentity, uninhabited: channel.uninhabited, jsRejection: false }])) }, call, entryContext);
    if (transport.kind === "mapped" && mapped === undefined)
      failRustPlannerInvariant("An admitted frame implementation requires its complete selected invocation error syntax.", implementation.declaration);
    const value = transport.kind === "mapped" ? mapped! : call;
    const unit = isRustUnitCarrier(callable.resultCarrier);
    const success: RustExpr = { kind: "call", path: "Ok",
      args: [unit ? { kind: "tuple-literal", elements: [] } : value] };
    const invoked: RustExpr = transport.kind !== "mapped" && fallible ? call
      : unit ? { kind: "evaluate-then", effect: value, discard: "unit", value: success } : success;
    arms.push({ pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "wildcard" }, ...(!entryHasPayload(implementation, emission) ? [] : [captures.length === 0
        ? { kind: "wildcard" as const } : { kind: "binding" as const, name: "state" }]),
    ] }, expression: invoked });
  }
  if (argumentTypes === undefined || resultType === undefined) failRustPlannerInvariant("An admitted native frame requires its complete storage and callable syntax.", definition.activation.ownerDeclaration);
  const independentType: RustType = { kind: "named", path: "rt::Callable", genericArguments: [
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "type", type: { kind: "tuple", elements: argumentTypes } }, { kind: "type", type: resultType },
  ] };
  if (entry.hasIndependent) {
    variants.push({ name: "Independent", fields: [independentType] });
    arms.push({ pattern: { kind: "tuple-variant", path: "Self::Independent", elements: [{ kind: "binding", name: "value" }] },
      expression: { kind: "method-call", receiver: { kind: "path", path: "value" }, method: "call",
        args: [{ kind: "path", path: "arguments" }] } });
  }
  items.push({ kind: "enum", name: entry.targetName, visibility: "public", generics, variants },
    ...entryClone(entry, types.entryType, generics, emission), ...entryEquality(entry, types.entryType, generics, emission),
    { kind: "impl", generics, trait: { kind: "named", path: "rt::FrameCallableEntry",
      genericArguments: [{ kind: "type", type: types.frameType }] }, target: types.entryType, members: [
      { kind: "type", name: "Arguments", generics: emptyRustGenerics, type: { kind: "tuple", elements: argumentTypes } },
      { kind: "type", name: "Result", generics: emptyRustGenerics, type: resultType },
      { kind: "function", name: "invoke", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
        params: [{ name: "frame", type: { kind: "reference", referent: shared(types.frameType), mutable: false } },
          // An entry with no arguments and no independent variant never reads its argument tuple.
          { name: argumentTypes.length === 0 && !entry.hasIndependent ? "_arguments" : "arguments",
            type: { kind: "named", path: "Self::Arguments" } }],
        returnType: { kind: "named", path: "Self::Result" },
        body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "self" }, arms } }] } },
    ] });
  if (entry.hasIndependent) items.push(...planRustFrameCallableFamilyItems(types, independentType, generics));
  return items;
}

export function planRustFrameCallableItems(context: RustPlanContext): readonly RustItem[] {
  const result: RustItem[] = [];
  const definitions = context.input.program.records.frameDeclarations.get(context.sourceFile);
  if (definitions === undefined) failRustPlannerInvariant("An admitted source module requires its sealed native frame inventory.", context.sourceFile);
  for (const definition of definitions) {
    const local = definitionContext(definition, context);
    const fields = definition.bindings.map(binding => {
      const type = rustFrameBindingType(binding, local);
      return type === undefined ? undefined : { name: binding.fieldName, type, visibility: "public" as const };
    });
    const entries = definition.entries.map(entry => planFrameEntry(definition, entry, local));
    if (fields.some(field => field === undefined) || entries.some(items => items === undefined)) {
      failRustPlannerInvariant("An admitted native frame requires its complete storage and invocation syntax.", definition.activation.ownerDeclaration);
    }
    context.usedAliases?.add("rt");
    const generics = definitionGenerics(definition, local);
    const marker = definitionMarker(generics);
    const emission = context.input.program.records.frameDeclaration.get(definition);
    if (emission === undefined) failRustPlannerInvariant("An admitted frame requires its sealed counter storage selection.", definition.activation.ownerDeclaration);
    const counterName = emission.counterName;
    if (definition.storage.kind === "standalone") result.push({ kind: "struct", name: definition.targetName, visibility: "public",
      generics, fields: [
        ...(counterName === undefined ? [] : [{ name: counterName, type: { kind: "named" as const, path: "rt::FrameEntryCounter" }, visibility: "public" as const }]),
        ...fields as { readonly name: string; readonly type: RustType; readonly visibility: "public" }[],
        ...(marker === undefined ? [] : [{ name: "marker", type: marker, visibility: "public" as const }]),
      ] });
    result.push(...(entries as readonly (readonly RustItem[])[]).flat());
  }
  return result;
}
