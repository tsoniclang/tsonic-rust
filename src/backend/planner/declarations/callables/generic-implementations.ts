import type { RustGenericCallableImplementation } from "../../../../target-model/records/generic-callables.js";
import type { RustGenericCallablePhysicalDefinition } from "../../../../target-model/records/generic-callables.js";
import type { RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

import type { RustExpr, RustFunctionParam, RustItem, RustPattern, RustType, RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustTypeFromCarrierInContext, rustTargetGenericArgumentToAstInContext, rustTargetCallGenericArgumentToAstInContext } from "../../types/render.js";
import type { RustTypeRenderingContext } from "../../types/render.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { planNativeModuleFunction } from "./functions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { genericCallableCopyStateItems, genericCallableStorageItems } from "./generic-storage.js";
import { authoredTypeParameterNames } from "@tsonic/target-api/source";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { rustInvariantTypeMarker } from "../../types/invariant-marker.js";
import { planRustGenericNativeFutureDispatch, type RustGenericNativeFutureInvocation } from "./generic-native-futures.js";
import { rustCallableCaptureStorageType } from "../../types/capture-storage.js";
import { rustCallablePayloadContext, rustCallablePayloadTypes } from "../../expressions/capture-payloads.js";
import { rustGenericCallableEnvironmentGenerics, rustGenericCallableCapturePredicates } from "./generic-signatures.js";
import { rustGenericCallableStorageArguments } from "../../../../target-model/types/carriers/generic-callable-storage.js";
import { planRustGenericCallableErrors } from "./generic-errors.js";

export function rustGenericCallableImplementationPath(
  implementation: RustGenericCallableImplementation, name: string, context: RustTypeRenderingContext,
): string | undefined {
  const module = context.moduleNameByFileName.get(implementation.sourceFileName);
  const external = context.externalCrateNameByFileName.get(implementation.sourceFileName);
  return module === undefined ? undefined : `${external !== undefined && external !== context.crateName ? external : "crate"}::${module}::${name}`;
}

export function rustGenericCallableCaptureType(
  capture: RustGenericCallableImplementation["captures"][number], context: RustTypeRenderingContext,
): RustType | undefined {
  return rustCallableCaptureStorageType(capture, capture.storageCarrier, context);
}

export function rustGenericCallableMarker(arguments_: readonly RustTargetGenericArgument[], context: RustTypeRenderingContext): RustType | undefined {
  const values = arguments_.map(argument => rustTargetGenericArgumentToAstInContext(argument, context));
  if (values.some(value => value === undefined || value.kind !== "type" && value.kind !== "lifetime")) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  return rustInvariantTypeMarker(values.map(value => value!.kind === "type" ? value!.type : {
    kind: "reference", mutable: false, referent: { kind: "unit" }, lifetime: (value as Extract<NonNullable<typeof value>, { kind: "lifetime" }>).lifetime,
  }));
}

export function planRustGenericCallableItems(context: RustPlanContext): readonly RustItem[] {
  const result: RustItem[] = [];
  const inventory = context.input.program.records.genericDeclarations.get(context.sourceFile);
  if (inventory === undefined) failRustPlannerInvariant("An admitted source module requires its generic declaration inventory.", context.sourceFile);
  for (const implementation of inventory.implementations) {
    result.push(...planImplementation(implementation, context));
  }
  for (const definition of inventory.definitions) {
    const items = planDefinition(definition, context);
    result.push(...items);
  }
  return result;
}

function planImplementation(
  implementation: RustGenericCallableImplementation, context: RustPlanContext,
): readonly RustItem[] {
  const emission = context.input.program.records.genericImplementation.get(implementation);
  if (emission === undefined) failRustPlannerInvariant("An admitted generic implementation requires its sealed emission record.", implementation.declaration);
  const selected = emission.environment;
  const arguments_ = emission.arguments;
  const helperContext = rustGeneratedTypeParameterContext(arguments_.flatMap(argument =>
    argument.kind === "type" && argument.type.kind === "type-parameter" ? [argument.type] : []),
    authoredTypeParameterNames(implementation.declaration, context.input.program.source.ast),
    { ...context, typeParameterSubstitutions: selected.substitutions.types, lifetimeSubstitutions: selected.substitutions.lifetimes });
  const captures = rustCallablePayloadTypes(selected, helperContext);
  if (captures === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
  const owner = allocateRustSyntheticName(names, "environment");
  const suspended = emission.suspended;
  const bodyContext = rustCallablePayloadContext(selected, { kind: "path", path: owner }, helperContext, "named");
  const planned = implementation.creation === "declaration" ? undefined
    : planNativeModuleFunction(implementation.declaration, implementation.declaration,
        implementation.functionName, bodyContext, undefined);
  const helpers = planned === undefined ? [] : planned.helper === undefined ? [planned.item] : [planned.item, planned.helper];
  const contract = emission.requirements;
  const generics = rustGenericCallableEnvironmentGenerics(arguments_, helperContext);
  if (generics === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const environment = generics.parameters;
  const parameters = environment.map((parameter, index) => {
    if (parameter.kind !== "type") return parameter;
    const argument = arguments_[index]!;
    if (argument.kind !== "type" || argument.type.kind !== "type-parameter") return parameter;
    const identity = argument.type.identity;
    const original = implementation.substitutions.find(([_identity, type]) => type.kind === "type-parameter" && type.identity === identity)?.[0];
    const requirements = contract.capturedTypeParameters.find(parameter => parameter.identity === original)?.requirements ?? [];
    return { ...parameter, bounds: rustGenericRequirementBounds(requirements) };
  });
  const fields = captures.map((_capture, index) => ({
    name: `capture_${index}`, type: captures[index]!, visibility: "public" as const,
  }));
  const marker = rustGenericCallableMarker(arguments_, helperContext);
  if (marker === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  if (environment.length > 0) fields.push({ name: "marker", type: marker, visibility: "public" });
  const stateArguments = arguments_.map(argument => rustTargetGenericArgumentToAstInContext(argument, helperContext));
  if (stateArguments.some(argument => argument === undefined)) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const state: RustType = { kind: "named", path: implementation.stateName,
    genericArguments: stateArguments as NonNullable<typeof stateArguments[number]>[],
  };
  const ownerParams: readonly RustFunctionParam[] = captures.length === 0 ? [] : [{ name: owner,
    type: suspended ? implementation.storage === "shared" ? shared(state) : state
      : { kind: "reference", referent: state, mutable: false },
  }];
  return [{ kind: "struct", name: implementation.stateName, visibility: "public",
    generics, fields,
  }, ...(implementation.storage === "value" ? genericCallableCopyStateItems(state, generics) : []),
  ...helpers.map(helper => ({ ...helper, generics: rustGenericsWithAssociatedBounds([...parameters, ...helper.generics.parameters],
    helper.generics.wherePredicates),
    params: [...ownerParams, ...helper.params],
  }))];
}

function planDefinition(definition: RustGenericCallablePhysicalDefinition, context: RustPlanContext): readonly RustItem[] {
  const emission = context.input.program.records.genericDefinition.get(definition);
  if (emission === undefined) failRustPlannerInvariant("An admitted generic family requires its sealed emission record.");
  const parameters = rustGenericCallableStorageArguments(definition.signature.environmentParameters, definition.parameters);
  const environment = rustGenericCallableEnvironmentGenerics(parameters, context);
  const arguments_ = parameters.map(parameter => rustTargetGenericArgumentToAstInContext(parameter, context));
  if (environment === undefined || arguments_.some(argument => argument === undefined)) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const variants = definition.members.map(member => {
    const implementation = member.implementation;
    const path = rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
    const selected = rustGenericCallableStorageArguments(definition.signature.environmentParameters, member.arguments)
      .map(argument => rustTargetGenericArgumentToAstInContext(argument, context));
    const state: RustType = { kind: "named", path: path ?? "", genericArguments: selected as NonNullable<typeof selected[number]>[] };
    return path === undefined || selected.some(argument => argument === undefined) ? undefined : { name: member.variantName,
      fields: [implementation.storage === "shared" ? shared(state) : state],
    };
  });
  if (variants.some(variant => variant === undefined)) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const target: RustType = { kind: "named", path: definition.targetName, genericArguments: arguments_ as NonNullable<typeof arguments_[number]>[] };
  const storage = genericCallableStorageItems(definition, environment, target, variants as NonNullable<typeof variants[number]>[],
    emission.identity);
  if (storage === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  if (!emission.invoked) return storage;
  const errors = planRustGenericCallableErrors(definition, context);
  const effects = errors.effects;
  const nativeFuture = emission.nativeFuture;
  const parameterTypes = emission.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context));
  const output = rustTypeFromCarrierInContext(emission.result, context);
  if (parameterTypes.some(type => type === undefined) || output === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const capturePredicates = rustGenericCallableCapturePredicates(definition, context);
  if (capturePredicates === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  const predicates = new Map<string, RustWherePredicate>(capturePredicates.map(predicate => [closedMetadataKey(predicate), predicate]));
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  const nativeInvocations: RustGenericNativeFutureInvocation[] = [];
  for (const member of definition.members) {
    const implementation = member.implementation;
    const contract = context.input.program.records.genericImplementation.get(implementation)?.requirements;
    const memberEmission = emission.members.get(member);
    if (memberEmission === undefined) failRustPlannerInvariant("An admitted generic family member requires its sealed completion record.", implementation.declaration);
    const path = rustGenericCallableImplementationPath(implementation, implementation.functionName, context);
    const bindings = member.bindings;
    if (contract === undefined || path === undefined || bindings === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
    const substitutions = bindings.types;
    for (const parameter of [...contract.typeParameters, ...contract.capturedTypeParameters]) {
      const type = substitutions.get(parameter.identity);
      if (type === undefined) continue;
      const rendered = rustTypeFromCarrierInContext(type, context);
      if (rendered === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
      const predicate: RustWherePredicate = { kind: "type", type: rendered, bounds: rustGenericRequirementBounds(parameter.requirements) };
      if (predicate.bounds.length > 0) predicates.set(closedMetadataKey(predicate), predicate);
    }
    for (const predicate of rustAssociatedPredicates(contract.associatedTypes, { ...context, typeParameterSubstitutions: substitutions }))
      predicates.set(closedMetadataKey(predicate), predicate);
    for (const predicate of rustProjectProjectionPredicates(contract.projectProjections, { ...context, typeParameterSubstitutions: substitutions }))
      predicates.set(closedMetadataKey(predicate), predicate);
    const suspended = memberEmission.suspended;
    const owner: RustExpr = { kind: "path", path: "environment" };
    const ownerArgument: RustExpr = suspended
      ? implementation.storage === "value" ? { kind: "dereference", pointer: owner }
        : { kind: "method-call", receiver: owner, method: "clone", args: [] }
      : implementation.storage === "shared" ? { kind: "method-call", receiver: owner, method: "as_ref", args: [] } : owner;
    const helperArguments = rustGenericCallableStorageArguments(definition.signature.environmentParameters, member.arguments)
      .filter(argument => argument.kind !== "lifetime").map(argument => rustTargetCallGenericArgumentToAstInContext(argument, context));
    if (helperArguments.some(argument => argument === undefined)) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
    const call: RustExpr = { kind: "call", path,
      genericArguments: [...helperArguments as NonNullable<typeof helperArguments[number]>[], ...definition.signature.typeParameters.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }))],
      args: [...(implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length === 0 ? [] : [ownerArgument]),
        ...parameterTypes.map((_type, index): RustExpr => ({ kind: "path", path: `argument_${index}` }))],
    };
    const pattern: RustPattern = { kind: "tuple-variant", path: `Self::${member.variantName}`,
      elements: [implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length === 0 ? { kind: "wildcard" } : { kind: "binding", name: "environment" }] };
    if (nativeFuture !== undefined) {
      const future = memberEmission.future;
      if (future === undefined) failRustPlannerInvariant("An admitted generic future requires its sealed invocation and awaiting contract.", implementation.declaration);
      nativeInvocations.push({ member, pattern, call, ...future });
      continue;
    }
    const methodFallible = effects.invocation === "fallible";
    const selected = errors.forMember(member);
    if (selected === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
    const converted = selected.invocation === undefined ? undefined : errors.invocation.propagatedValue(selected.invocation, call);
    if (selected.invocation !== undefined && converted === undefined) failRustPlannerInvariant("An admitted generic invocation requires its selected native error injection.", implementation.declaration);
    if (memberEmission.completionVariant === undefined) {
      arms.push({ pattern, expression: converted !== undefined ? converted :
        methodFallible ? { kind: "call", path: "Ok", args: [call] } : call });
    } else {
      const value: RustExpr = { kind: "associated-call", owner: output, method: memberEmission.completionVariant,
        args: [selected.invocation === undefined ? call : errors.invocation.propagateReturn(selected.invocation, call)!] };
      arms.push({ pattern, expression: methodFallible ? { kind: "call", path: "Ok", args: [value] } : value });
    }
  }
  const generics = environment;
  const methodFallible = effects.invocation === "fallible";
  const methodOutput: RustType = methodFallible
    ? { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: output }, { kind: "type", type: errors.invocation.errorType! }] }
    : output;
  const dispatch: RustExpr = { kind: "match", expression: { kind: "path", path: "self" }, arms };
  const native = nativeFuture === undefined ? undefined : planRustGenericNativeFutureDispatch({
    definition, output, effects, errors, optional: nativeFuture.optional,
    captures: [...arguments_ as NonNullable<typeof arguments_[number]>[],
      ...definition.signature.typeParameters.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }))],
    invocations: nativeInvocations,
  });
  if (nativeFuture !== undefined && native === undefined) failRustPlannerInvariant("An admitted generic callable requires its complete native environment and quantified call contract.");
  return [...storage,
  ...(native?.items ?? []),
  { kind: "impl", target, generics, members: [{ kind: "function",
    name: "call", visibility: "public", selfParam: { kind: "reference", mutable: false },
    generics: { parameters: definition.signature.typeParameters.map(parameter => ({ kind: "type", name: parameter.name, bounds: [] })),
      wherePredicates: [...predicates.values()],
    }, params: parameterTypes.map((type, index) => ({ name: `argument_${index}`, type: type! })),
    returnType: native?.returnType ?? methodOutput,
    body: native?.body ?? { statements: [{ kind: "tail", expr: dispatch }] },
  }] }];
}

function shared(type: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}


