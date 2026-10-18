import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallableImplementation } from "../../../../analysis/callables/frame-values.js";

import type { RustExpr, RustGenerics, RustItem, RustPattern, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput, requireRustEmissionContext, rustContextForEmission } from "../../program/plan-context.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../../diagnostics.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../../types/render.js";
import { requireRustNativeCaptureEnvironment, requireRustNativeCaptureStorage, requireRustNativeFrameStorage } from "../../expressions/binding-storage.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { rustCallablePayloadContext } from "../../expressions/capture-payloads.js";
import { rustFrameBindingContext, rustFrameBindingType } from "../../bindings/frame-storage.js";
import { planNativeModuleFunction } from "./functions.js";
import { genericCallableCopyStateItems } from "./generic-storage.js";
import { rustSelfParameter } from "./self-parameter.js";
import { rustInvariantTypeMarker } from "../../types/invariant-marker.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustDeclarationAssociatedPredicates } from "../../types/associated-bounds.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import type { RustLiveFrameOwner } from "../../program/frame-owners.js";
import { planRustFrameCallableFamilyItems } from "./frame-family-implementations.js";
import { rustRetainedFrameCounterName } from "../../../../analysis/callables/frame-counter-storage.js";

function shared(type: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}

function definitionContext(definition: RustFrameCallableDefinition, context: RustPlanContext): RustPlanContext {
  return rustGeneratedTypeParameterContext(definition.environmentParameters, [],
    { ...rustContextForEmission(context, requireRustEmissionContext(context, definition, "frame", definition.activation.ownerDeclaration)),
      callableDeclaration: definition.activation.ownerDeclaration });
}

function definitionGenerics(definition: RustFrameCallableDefinition, context: RustPlanContext): RustGenerics {
  const contracts = definition.entries.flatMap(entry => entry.implementations).map(implementation =>
    context.input.program.declarationGenericRequirements.contractFor(implementation.declaration));
  if (contracts.some(contract => contract === undefined)) throw new Error("A sealed frame entry lost its generic requirement contract.");
  return rustGenericsWithAssociatedBounds(definition.environmentParameters.map(parameter => ({ kind: "type", name:
    context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
    bounds: rustGenericRequirementBounds([...new Set(contracts.flatMap(contract =>
      [...contract!.typeParameters, ...contract!.capturedTypeParameters].filter(selected => selected.identity === parameter.identity)
        .flatMap(selected => selected.requirements)))]) })), [...new Map(contracts.flatMap(contract =>
    rustDeclarationAssociatedPredicates(contract!.declaration, context)).map(predicate => [closedMetadataKey(predicate), predicate])).values()]);
}

function definitionMarker(generics: RustGenerics): RustType | undefined {
  const parameters = generics.parameters.filter(parameter => parameter.kind === "type")
    .map(parameter => ({ kind: "named" as const, path: parameter.name }));
  return parameters.length === 0 ? undefined : rustInvariantTypeMarker(parameters);
}

function entryHasPayload(
  definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition,
  implementation: RustFrameCallableImplementation, context: RustPlanContext,
): boolean {
  const emission = requireRustEmissionContext(context, definition, "frame", definition.activation.ownerDeclaration);
  return requireRustNativeCaptureEnvironment(emission,
    { kind: "frame", definition, entry, implementation }, context).payload.kind === "named";
}

function entryClone(
  definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition,
  target: RustType, generics: RustGenerics, context: RustPlanContext,
): readonly RustItem[] {
  if (entry.copy) return genericCallableCopyStateItems(target, generics);
  return [{ kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, members: [{
    kind: "function", name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: [
        ...entry.implementations.filter(implementation => !implementation.independent).map((implementation):
          Extract<RustExpr, { readonly kind: "match" }>["arms"][number] => ({
        pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
          { kind: "binding", name: "identity" }, ...(!entryHasPayload(definition, entry, implementation, context) ? [] : [{ kind: "binding" as const, name: "state" }]),
        ] },
        expression: { kind: "call", path: `Self::${implementation.variantName}`, args: [
          { kind: "dereference", pointer: { kind: "path", path: "identity" } },
          ...(!entryHasPayload(definition, entry, implementation, context) ? [] : [implementation.copy
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

function entryEquality(
  definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition,
  target: RustType, generics: RustGenerics, context: RustPlanContext,
): readonly RustItem[] {
  const pattern = (implementation: RustFrameCallableImplementation, name: string): RustPattern => ({
    kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "binding", name }, ...(!entryHasPayload(definition, entry, implementation, context) ? [] : [{ kind: "wildcard" as const }]),
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
  const nativeFrame = requireRustNativeFrameStorage(definition, context.emissionContext);
  const frameType = rustTypeFromSelectedNativeCarrierInContext(nativeFrame.carrier, context);
  const emission = requireRustEmissionContext(context, definition, "frame", definition.activation.ownerDeclaration);
  const signatures = emission.frameEntries.filter(selected => selected.entry === entry);
  if (signatures.length !== 1) return failRustPlannerInvariant(
    "A sealed native frame entry lost its exact selected invocation ABI.", definition.activation.ownerDeclaration);
  const signature = signatures[0]!;
  const argumentTypes = signature.parameters.map(carrier => rustTypeFromSelectedNativeCarrierInContext(carrier, context));
  const returned = rustTypeFromSelectedNativeCarrierInContext(signature.result, context);
  const error = rustTypeFromSelectedNativeCarrierInContext(signature.error, context);
  const resultType: RustType = { kind: "named", path: "Result", genericArguments: [
    { kind: "type", type: returned }, { kind: "type", type: error },
  ] };
  const generics = definitionGenerics(definition, context);
  const entryType: RustType = { kind: "named", path: entry.targetName, genericArguments: generics.parameters
    .filter(parameter => parameter.kind === "type").map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })) };
  const types = { frameType, entryType };
  const items: RustItem[] = [];
  const variants: Extract<RustItem, { readonly kind: "enum" }>["variants"][number][] = [];
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const implementation of entry.implementations) {
    if (implementation.independent) continue;
    const suspended = context.input.program.records.asyncFunction.get(implementation.declaration) !== undefined ||
      context.input.program.records.generator.get(implementation.declaration) !== undefined;
    const nativeEnvironment = requireRustNativeCaptureEnvironment(emission,
      { kind: "frame", definition, entry, implementation }, context);
    const payload = nativeEnvironment.payload;
    const state = payload.kind === "none" ? undefined : rustTypeFromSelectedNativeCarrierInContext(payload.stateCarrier, context);
    const holder = payload.kind === "none" ? undefined : rustTypeFromSelectedNativeCarrierInContext(payload.holderCarrier, context);
    const frameHolder = rustTypeFromSelectedNativeCarrierInContext(nativeEnvironment.frame.holderCarrier, context);
    const captures = nativeEnvironment.slots.map((_slot, index) => rustTypeFromSelectedNativeCarrierInContext(
      requireRustNativeCaptureStorage(nativeEnvironment, index, emission, context).owner.fieldCarrier, context));
    if (captures.length !== 0 && (state === undefined || holder === undefined)) return failRustPlannerInvariant(
      "A sealed captured frame entry requires its completed native state and holder.", implementation.declaration);
    const marker = definitionMarker(generics);
    if (payload.kind === "named") {
      items.push({ kind: "struct", name: implementation.stateName, visibility: "public", generics,
        fields: [...captures.map((type, index) => {
          const path = payload.slotPaths[index];
          if (path?.length !== 1 || path[0] === undefined) return failRustPlannerInvariant(
            "A named frame environment requires its exact selected native capture field.", implementation.declaration);
          return { name: path[0], type, visibility: "public" as const };
        }),
          ...(marker === undefined ? [] : [{ name: "marker", type: marker, visibility: "public" as const }])] });
      if (state === undefined) return failRustPlannerInvariant("A named frame environment lost its native state carrier.", implementation.declaration);
      if (implementation.copy) items.push(...genericCallableCopyStateItems(state, generics));
    }
    const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
    const frameName = allocateRustSyntheticName(names, "frame_owner");
    const stateName = allocateRustSyntheticName(names, "frame_state");
    const owner: RustLiveFrameOwner = { kind: "live", expression: { kind: "path", path: frameName }, borrowed: !suspended,
      data: definition.storage.kind === "standalone" ? { kind: "direct" }
        : { kind: "object", mutable: definition.storage.mutable, name: allocateRustSyntheticName(names, "frame_data") } };
    const helperContext = rustFrameBindingContext(definition, owner,
      rustCallablePayloadContext(implementation, { kind: "path", path: stateName }, context));
    const helper = planNativeModuleFunction(implementation.declaration, implementation.declaration,
      implementation.functionName, true, helperContext,
      requireRustEmissionContext(context, implementation.declaration, "native-body", implementation.declaration));
    if (helper?.kind !== "function" || helper.isAsync === true) return undefined;
    const parameters = helper.params;
    const fallible = helper.errorType !== undefined;
    items.push({ ...helper, generics, params: [
      { name: frameName, type: suspended ? frameHolder
        : { kind: "reference", referent: frameHolder, mutable: false } },
      ...(captures.length === 0 ? [] : [{ name: stateName, type: state === undefined || holder === undefined
        ? failRustPlannerInvariant("A frame helper lost its selected native capture parameter.", implementation.declaration)
        : suspended ? holder : { kind: "reference" as const, referent: state, mutable: false } }]),
      ...parameters,
    ] });
    variants.push({ name: implementation.variantName, fields: [{ kind: "primitive", name: "usize" },
      ...(payload.kind === "none" ? [] : [holder === undefined
        ? failRustPlannerInvariant("A named frame variant lost its exact native holder.", implementation.declaration) : holder])] });
    const call: RustExpr = { kind: "call", path: implementation.functionName, args: [
      suspended ? { kind: "call", path: "alloc::rc::Rc::clone", args: [{ kind: "path", path: "frame" }] }
        : { kind: "path", path: "frame" },
      ...(captures.length === 0 ? [] : [!suspended ? { kind: "path" as const, path: "state" }
        : implementation.copy ? { kind: "dereference" as const, pointer: { kind: "path" as const, path: "state" } }
          : { kind: "call" as const, path: "alloc::rc::Rc::clone", args: [{ kind: "path" as const, path: "state" }] }]),
      ...parameters.map((_parameter, index) => ({ kind: "field" as const,
        receiver: { kind: "path" as const, path: "arguments" }, name: String(index) })),
    ] };
    arms.push({ pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "wildcard" }, ...(payload.kind === "none" ? [] : [captures.length === 0
        ? { kind: "wildcard" as const } : { kind: "binding" as const, name: "state" }]),
    ] }, expression: fallible ? call : { kind: "call", path: "Ok", args: [call] } });
  }
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
    ...entryClone(definition, entry, types.entryType, generics, context),
    ...entryEquality(definition, entry, types.entryType, generics, context),
    { kind: "impl", generics, trait: { kind: "named", path: "rt::FrameCallableEntry",
      genericArguments: [{ kind: "type", type: types.frameType }] }, target: types.entryType, members: [
      { kind: "type", name: "Arguments", generics: emptyRustGenerics, type: { kind: "tuple", elements: argumentTypes } },
      { kind: "type", name: "Result", generics: emptyRustGenerics, type: resultType },
      { kind: "function", name: "invoke", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
        params: [{ name: "frame", type: { kind: "reference", referent: shared(types.frameType), mutable: false } },
          { name: "arguments", type: { kind: "named", path: "Self::Arguments" } }],
        returnType: { kind: "named", path: "Self::Result" },
        body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "self" }, arms } }] } },
    ] });
  if (entry.hasIndependent) items.push(...planRustFrameCallableFamilyItems(types, independentType, generics));
  return items;
}

export function planRustNativeFrameStorageItems(
  definition: RustFrameCallableDefinition, context: RustPlanContext,
): readonly RustItem[] | undefined {
  const local = definitionContext(definition, context);
  const fields: { readonly name: string; readonly type: RustType; readonly visibility: "public" }[] = [];
  for (const binding of definition.bindings) {
    const type = rustFrameBindingType(binding, local);
    if (type === undefined) return undefined;
    fields.push({ name: binding.fieldName, type, visibility: "public" });
  }
  if (definition.storage.kind !== "standalone") return [];
  const generics = definitionGenerics(definition, local);
  const marker = definitionMarker(generics);
  const counterName = rustRetainedFrameCounterName(definition, context.input.program);
  context.usedAliases?.add("rt");
  return [{ kind: "struct", name: definition.targetName, visibility: "public", generics, fields: [
    ...(counterName === undefined ? [] : [{ name: counterName,
      type: { kind: "named" as const, path: "rt::FrameEntryCounter" }, visibility: "public" as const }]),
    ...fields,
    ...(marker === undefined ? [] : [{ name: "marker", type: marker, visibility: "public" as const }]),
  ] }];
}

export function planRustFrameCallableItems(context: RustPlanContext): readonly RustItem[] {
  const result: RustItem[] = [];
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  for (const definition of context.input.program.callableValues.frames.definitions) {
    if (definition.ownerFileName !== fileName) continue;
    const local = definitionContext(definition, context);
    const storage = planRustNativeFrameStorageItems(definition, context);
    const entries = definition.entries.map(entry => planFrameEntry(definition, entry, local));
    if (storage === undefined || entries.some(items => items === undefined)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, definition.activation.ownerDeclaration),
        "rust.backend.frame-declaration", "A native frame requires its complete selected storage and invocation protocol."));
      continue;
    }
    context.usedAliases?.add("rt");
    result.push(...storage);
    result.push(...(entries as readonly (readonly RustItem[])[]).flat());
  }
  return result;
}
