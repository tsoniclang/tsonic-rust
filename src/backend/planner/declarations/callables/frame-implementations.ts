import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallableImplementation } from "../../../../analysis/callables/frame-values.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey } from "../../../../analysis/facts/keys.js";
import type { RustExpr, RustGenerics, RustItem, RustPattern, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput, rustCurrentErrorBoundary, rustErrorType } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { rustFrameCallableTypes } from "../../types/frame-callables.js";
import { rustCallableCaptureStorageType } from "../../types/capture-storage.js";
import { rustFrameBindingContext, rustFrameBindingType } from "../../bindings/frame-storage.js";
import { planNativeModuleFunction } from "./functions.js";
import { genericCallableCopyStateItems } from "./generic-storage.js";
import { rustSelfParameter } from "./self-parameter.js";
import { rustInvariantTypeMarker } from "../../types/invariant-marker.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustDeclarationAssociatedPredicates } from "../../types/associated-bounds.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";

function shared(type: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}

function definitionContext(definition: RustFrameCallableDefinition, context: RustPlanContext): RustPlanContext {
  return rustGeneratedTypeParameterContext(definition.environmentParameters, [],
    { ...context, callableDeclaration: definition.activation.ownerDeclaration });
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

function entryHasPayload(implementation: RustFrameCallableImplementation, generics: RustGenerics): boolean {
  return implementation.captures.length !== 0 || definitionMarker(generics) !== undefined;
}

function stateType(implementation: RustFrameCallableImplementation, generics: RustGenerics): RustType {
  return { kind: "named", path: implementation.stateName, genericArguments: generics.parameters
    .filter(parameter => parameter.kind === "type").map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })) };
}

function entryClone(
  entry: RustFrameCallableEntryDefinition, target: RustType, generics: RustGenerics,
): readonly RustItem[] {
  if (entry.copy) return genericCallableCopyStateItems(target, generics);
  return [{ kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, members: [{
    kind: "function", name: "clone", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [], returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: entry.implementations.map(implementation => ({
        pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
          { kind: "binding", name: "identity" }, ...(!entryHasPayload(implementation, generics) ? [] : [{ kind: "binding" as const, name: "state" }]),
        ] },
        expression: { kind: "call", path: `Self::${implementation.variantName}`, args: [
          { kind: "dereference", pointer: { kind: "path", path: "identity" } },
          ...(!entryHasPayload(implementation, generics) ? [] : [implementation.copy
            ? { kind: "dereference" as const, pointer: { kind: "path" as const, path: "state" } }
            : { kind: "method-call" as const, receiver: { kind: "path" as const, path: "state" }, method: "clone", args: [] }]),
        ] },
      })),
    } }] },
  }] }];
}

function entryEquality(entry: RustFrameCallableEntryDefinition, target: RustType, generics: RustGenerics): readonly RustItem[] {
  const pattern = (implementation: RustFrameCallableImplementation, name: string): RustPattern => ({
    kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "binding", name }, ...(!entryHasPayload(implementation, generics) ? [] : [{ kind: "wildcard" as const }]),
    ],
  });
  return [{ kind: "impl", trait: { kind: "named", path: "PartialEq" }, target, generics, members: [{
    kind: "function", name: "eq", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
    params: [{ name: "other", type: { kind: "reference", referent: { kind: "named", path: "Self" }, mutable: false } }],
    returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "tuple-literal", elements: [{ kind: "path", path: "self" }, { kind: "path", path: "other" }] },
      arms: [...entry.implementations.map(implementation => ({
        pattern: { kind: "tuple" as const, elements: [pattern(implementation, "left"), pattern(implementation, "right")] },
        expression: { kind: "binary" as const, operator: "==" as const,
          left: { kind: "path" as const, path: "left" }, right: { kind: "path" as const, path: "right" } },
      })), ...(entry.implementations.length <= 1 ? [] : [{
        pattern: { kind: "wildcard" as const }, expression: { kind: "bool-literal" as const, value: false },
      }])],
    } }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "Eq" }, target, generics, members: [] }];
}

function planFrameEntry(
  definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition, context: RustPlanContext,
): readonly RustItem[] | undefined {
  const carrier = entry.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  const boundary = rustCurrentErrorBoundary(context);
  if (types === undefined || boundary === undefined) return undefined;
  const generics = definitionGenerics(definition, context);
  const items: RustItem[] = [];
  const variants: Extract<RustItem, { readonly kind: "enum" }>["variants"][number][] = [];
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  let argumentTypes: readonly RustType[] | undefined;
  let resultType: RustType | undefined;
  for (const implementation of entry.implementations) {
    if (context.input.program.facts.getFact(implementation.declaration, rustAsyncFunctionFactKey) !== undefined ||
      context.input.program.facts.getFact(implementation.declaration, rustGeneratorFactKey) !== undefined) return undefined;
    const state = stateType(implementation, generics);
    const captures = implementation.captures.map(capture => rustCallableCaptureStorageType(capture, capture.carrier, context));
    if (captures.some(type => type === undefined)) return undefined;
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
    const owner = { expression: { kind: "path" as const, path: frameName }, borrowed: true };
    const helperContext = rustFrameBindingContext(definition, owner, { ...context,
      capturedBindings: implementation.captures.map((capture, index) => ({
        declaration: capture.declaration, valueCarrier: capture.carrier, storage: capture.storage, borrowed: "shared" as const,
        expression: { kind: "reference" as const, expr: { kind: "field" as const,
          receiver: { kind: "path" as const, path: stateName }, name: `capture_${index}` } },
      })),
    });
    const helper = planNativeModuleFunction(implementation.declaration, implementation.declaration,
      implementation.functionName, true, helperContext);
    if (helper?.kind !== "function") return undefined;
    const parameters = helper.params;
    argumentTypes ??= parameters.map(parameter => parameter.type);
    const fallible = context.input.program.facts.getFact(implementation.declaration, rustFallibleFactKey) !== undefined;
    const output: RustType = { kind: "named", path: "Result", genericArguments: [
      { kind: "type" as const, type: helper.returnType ?? { kind: "unit" as const } },
      { kind: "type" as const, type: rustErrorType(boundary) },
    ] };
    resultType ??= output;
    items.push({ ...helper, generics, params: [
      { name: frameName, type: { kind: "reference", referent: shared(types.frameType), mutable: false } },
      ...(captures.length === 0 ? [] : [{ name: stateName, type: { kind: "reference" as const, referent: state, mutable: false } }]),
      ...parameters,
    ] });
    variants.push({ name: implementation.variantName, fields: [{ kind: "primitive", name: "usize" },
      ...(!entryHasPayload(implementation, generics) ? [] : [implementation.copy ? state : shared(state)])] });
    const call: RustExpr = { kind: "call", path: implementation.functionName, args: [
      { kind: "path", path: "frame" }, ...(captures.length === 0 ? [] : [{ kind: "path" as const, path: "state" }]),
      ...parameters.map((_parameter, index) => ({ kind: "field" as const,
        receiver: { kind: "path" as const, path: "arguments" }, name: String(index) })),
    ] };
    arms.push({ pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`, elements: [
      { kind: "wildcard" }, ...(!entryHasPayload(implementation, generics) ? [] : [captures.length === 0
        ? { kind: "wildcard" as const } : { kind: "binding" as const, name: "state" }]),
    ] }, expression: fallible ? call : { kind: "call", path: "Ok", args: [call] } });
  }
  if (argumentTypes === undefined || resultType === undefined) return undefined;
  items.push({ kind: "enum", name: entry.targetName, visibility: "public", generics, variants },
    ...entryClone(entry, types.entryType, generics), ...entryEquality(entry, types.entryType, generics),
    { kind: "impl", generics, trait: { kind: "named", path: "rt::FrameCallableEntry",
      genericArguments: [{ kind: "type", type: types.frameType }] }, target: types.entryType, members: [
      { kind: "type", name: "Arguments", type: { kind: "tuple", elements: argumentTypes } },
      { kind: "type", name: "Result", type: resultType },
      { kind: "function", name: "invoke", visibility: "private", selfParam: rustSelfParameter("ref"), generics: emptyRustGenerics,
        params: [{ name: "frame", type: { kind: "reference", referent: shared(types.frameType), mutable: false } },
          { name: "arguments", type: { kind: "named", path: "Self::Arguments" } }],
        returnType: { kind: "named", path: "Self::Result" },
        body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "self" }, arms } }] } },
    ] });
  return items;
}

export function planRustFrameCallableItems(context: RustPlanContext): readonly RustItem[] {
  const result: RustItem[] = [];
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  for (const definition of context.input.program.callableValues.frames.definitions) {
    if (definition.ownerFileName !== fileName || definition.activation.kind !== "lexical") continue;
    const local = definitionContext(definition, context);
    const fields = definition.bindings.map(binding => {
      const type = rustFrameBindingType(binding, local);
      return type === undefined ? undefined : { name: binding.fieldName, type, visibility: "public" as const };
    });
    const entries = definition.entries.map(entry => planFrameEntry(definition, entry, local));
    if (fields.some(field => field === undefined) || entries.some(items => items === undefined)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, definition.activation.ownerDeclaration),
        "rust.backend.frame-declaration", "A native frame requires its complete selected storage and invocation protocol."));
      continue;
    }
    context.usedAliases?.add("rt");
    const generics = definitionGenerics(definition, local);
    const marker = definitionMarker(generics);
    result.push({ kind: "struct", name: definition.targetName, visibility: "public",
      generics, fields: [
        { name: "counter", type: { kind: "named", path: "rt::FrameEntryCounter" }, visibility: "public" },
        ...fields as { readonly name: string; readonly type: RustType; readonly visibility: "public" }[],
        ...(marker === undefined ? [] : [{ name: "marker", type: marker, visibility: "public" as const }]),
      ] }, ...(entries as readonly (readonly RustItem[])[]).flat());
  }
  return result;
}
