import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import type { RustGenericCallablePhysicalDefinition } from "../../../../analysis/callables/generic-physical.js";
import type { RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol, rustNativeFutureCallableResult } from "../../../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactKey, rustGeneratorFactKey, rustSourceCallEffectsFactKey, rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";
import type { RustExpr, RustFunctionParam, RustItem, RustPattern, RustType, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { rustTypeFromCarrierInContext, rustTargetGenericArgumentToAstInContext, rustTargetCallGenericArgumentToAstInContext } from "../../types/render.js";
import type { RustTypeRenderingContext } from "../../types/render.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { planNativeModuleFunction } from "./functions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { genericCallableCopyStateItems, genericCallableStorageItems } from "./generic-storage.js";
import { rustAuthoredTypeParameterNames } from "../../../../target-model/names/type-parameters.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { rustInvariantTypeMarker } from "../../types/invariant-marker.js";
import { planRustGenericNativeFutureDispatch, type RustGenericNativeFutureInvocation } from "./generic-native-futures.js";
import { rustCallableCaptureStorageType } from "../../types/capture-storage.js";
import { validateRustCapturedReceiverFields, validateRustCapturedReceivers } from "../../expressions/receiver-captures.js";
import { rustCallablePayloadContext, rustCallablePayloadTypes } from "../../expressions/capture-payloads.js";
import { rustGenericCallableEnvironmentGenerics, rustGenericCallableCapturePredicates } from "./generic-signatures.js";
import { rustGenericCallableMemberBindings } from "../../../../analysis/callables/generic-bindings.js";
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
  if (values.some(value => value === undefined || value.kind !== "type" && value.kind !== "lifetime")) return undefined;
  return rustInvariantTypeMarker(values.map(value => value!.kind === "type" ? value!.type : {
    kind: "reference", mutable: false, referent: { kind: "unit" }, lifetime: (value as Extract<NonNullable<typeof value>, { kind: "lifetime" }>).lifetime,
  }));
}

export function planRustGenericCallableItems(context: RustPlanContext): readonly RustItem[] {
  const result: RustItem[] = [];
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  for (const definition of context.input.program.callableValues.generic.definitions) {
    for (const implementation of definition.implementations) {
      if (implementation.sourceFileName !== fileName) continue;
      const items = planImplementation(definition, implementation, context);
      if (items === undefined) reject(implementation.declaration, context);
      else result.push(...items);
    }
  }
  for (const definition of context.input.program.callableValues.generic.physical.definitions()) {
    if (definition.ownerFileName !== fileName) continue;
    const items = planDefinition(definition, context);
    if (items === undefined) reject(definition.implementations[0]!.declaration, context);
    else result.push(...items);
  }
  return result;
}

function planImplementation(
  definition: RustGenericCallableDefinition, implementation: RustGenericCallableImplementation, context: RustPlanContext,
): readonly RustItem[] | undefined {
  const selected = context.input.program.callableValues.generic.physical.environmentFor(implementation);
  if (selected === undefined) return undefined;
  const arguments_ = rustGenericCallableStorageArguments(definition.signature.environmentParameters, selected.parameters);
  const helperContext = rustGeneratedTypeParameterContext(arguments_.flatMap(argument =>
    argument.kind === "type" && argument.type.kind === "type-parameter" ? [argument.type] : []),
    rustAuthoredTypeParameterNames(implementation.declaration, context.input.program.source.ast),
    { ...context, typeParameterSubstitutions: selected.substitutions.types, lifetimeSubstitutions: selected.substitutions.lifetimes });
  const captures = rustCallablePayloadTypes(selected, helperContext);
  if (captures === undefined) return undefined;
  const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
  const owner = allocateRustSyntheticName(names, "environment");
  const suspended = context.input.program.facts.getFact(implementation.declaration, rustAsyncFunctionFactKey) !== undefined ||
    context.input.program.facts.getFact(implementation.declaration, rustGeneratorFactKey) !== undefined;
  if (suspended && implementation.storage !== "shared" && rustNativeFutureCallableResult(definition.signature.result) === undefined) return undefined;
  if (!validateRustCapturedReceiverFields(implementation.declaration, implementation.receiverFields, context) ||
    !validateRustCapturedReceivers(implementation.declaration, implementation.receivers, context)) return undefined;
  const bodyContext = rustCallablePayloadContext(selected, { kind: "path", path: owner }, helperContext);
  const helper = planNativeModuleFunction(implementation.declaration, implementation.declaration,
    implementation.functionName, true, bodyContext);
  if (helper?.kind !== "function") return undefined;
  const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
  if (contract === undefined) return undefined;
  const generics = rustGenericCallableEnvironmentGenerics(arguments_, helperContext);
  if (generics === undefined) return undefined;
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
  if (marker === undefined) return undefined;
  if (environment.length > 0) fields.push({ name: "marker", type: marker, visibility: "public" });
  const stateArguments = arguments_.map(argument => rustTargetGenericArgumentToAstInContext(argument, helperContext));
  if (stateArguments.some(argument => argument === undefined)) return undefined;
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
  { ...helper, generics: rustGenericsWithAssociatedBounds([...parameters, ...helper.generics.parameters],
    helper.generics.wherePredicates),
    params: [...ownerParams, ...helper.params],
  }];
}

function planDefinition(definition: RustGenericCallablePhysicalDefinition, context: RustPlanContext): readonly RustItem[] | undefined {
  const parameters = rustGenericCallableStorageArguments(definition.signature.environmentParameters, definition.parameters);
  const environment = rustGenericCallableEnvironmentGenerics(parameters, context);
  const arguments_ = parameters.map(parameter => rustTargetGenericArgumentToAstInContext(parameter, context));
  if (environment === undefined || arguments_.some(argument => argument === undefined)) return undefined;
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
  if (variants.some(variant => variant === undefined)) return undefined;
  const target: RustType = { kind: "named", path: definition.targetName, genericArguments: arguments_ as NonNullable<typeof arguments_[number]>[] };
  const storage = genericCallableStorageItems(definition, environment, target, variants as NonNullable<typeof variants[number]>[]);
  if (!context.input.program.callableValues.genericDispatch.requiredFor(definition)) return storage;
  const signatureCarrier = rustGenericCallableCarrier({ origin: definition.origin, signature: definition.signature,
    environment: definition.signature.environmentParameters,
  });
  const protocol = rustGenericCallableProtocol(signatureCarrier);
  const errors = planRustGenericCallableErrors(definition, context);
  if (protocol === undefined || errors === undefined) return undefined;
  const effects = errors.effects;
  const nativeFuture = rustNativeFutureCallableResult(protocol.result);
  const completion = context.input.program.callableValues.genericCompletions.forDefinition(definition);
  if (completion.kind === "unresolved") return undefined;
  const payload = nativeFuture?.output ?? completion.result;
  const parameterTypes = protocol.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context));
  const output = rustTypeFromCarrierInContext(payload, context);
  if (parameterTypes.some(type => type === undefined) || output === undefined) return undefined;
  const capturePredicates = rustGenericCallableCapturePredicates(definition, context);
  if (capturePredicates === undefined) return undefined;
  const predicates = new Map<string, RustWherePredicate>(capturePredicates.map(predicate => [closedMetadataKey(predicate), predicate]));
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  const nativeInvocations: RustGenericNativeFutureInvocation[] = [];
  for (const member of definition.members) {
    const implementation = member.implementation;
    const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
    const path = rustGenericCallableImplementationPath(implementation, implementation.functionName, context);
    const bindings = rustGenericCallableMemberBindings(definition, member, {
      ast: context.input.program.source.ast, sourceLifetimes: context.input.program.sourceLifetimes,
      physical: context.input.program.callableValues.generic.physical,
    });
    if (contract === undefined || path === undefined || bindings === undefined) return undefined;
    const substitutions = bindings.types;
    for (const parameter of [...contract.typeParameters, ...contract.capturedTypeParameters]) {
      const type = substitutions.get(parameter.identity);
      if (type === undefined) continue;
      const rendered = rustTypeFromCarrierInContext(type, context);
      if (rendered === undefined) return undefined;
      const predicate: RustWherePredicate = { kind: "type", type: rendered, bounds: rustGenericRequirementBounds(parameter.requirements) };
      if (predicate.bounds.length > 0) predicates.set(closedMetadataKey(predicate), predicate);
    }
    for (const predicate of rustAssociatedPredicates(contract.associatedTypes, { ...context, typeParameterSubstitutions: substitutions }))
      predicates.set(closedMetadataKey(predicate), predicate);
    for (const predicate of rustProjectProjectionPredicates(contract.projectProjections, { ...context, typeParameterSubstitutions: substitutions }))
      predicates.set(closedMetadataKey(predicate), predicate);
    const asyncFact = context.input.program.facts.getFact(implementation.declaration, rustAsyncFunctionFactKey);
    const suspended = asyncFact !== undefined ||
      context.input.program.facts.getFact(implementation.declaration, rustGeneratorFactKey) !== undefined;
    if (nativeFuture !== undefined && asyncFact !== undefined && asyncFact.kind !== "native-future") return undefined;
    const owner: RustExpr = { kind: "path", path: "environment" };
    const ownerArgument: RustExpr = suspended
      ? implementation.storage === "value" ? { kind: "dereference", pointer: owner }
        : { kind: "method-call", receiver: owner, method: "clone", args: [] }
      : implementation.storage === "shared" ? { kind: "method-call", receiver: owner, method: "as_ref", args: [] } : owner;
    const helperArguments = rustGenericCallableStorageArguments(definition.signature.environmentParameters, member.arguments)
      .filter(argument => argument.kind !== "lifetime").map(argument => rustTargetCallGenericArgumentToAstInContext(argument, context));
    if (helperArguments.some(argument => argument === undefined)) return undefined;
    const call: RustExpr = { kind: "call", path,
      genericArguments: [...helperArguments as NonNullable<typeof helperArguments[number]>[], ...definition.signature.typeParameters.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }))],
      args: [...(implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length === 0 ? [] : [ownerArgument]),
        ...parameterTypes.map((_type, index): RustExpr => ({ kind: "path", path: `argument_${index}` }))],
    };
    const pattern: RustPattern = { kind: "tuple-variant", path: `Self::${member.variantName}`,
      elements: [implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length === 0 ? { kind: "wildcard" } : { kind: "binding", name: "environment" }] };
    if (nativeFuture !== undefined) {
      const selectedEffects = context.input.program.facts.getFact(implementation.declaration, rustSourceCallEffectsFactKey);
      const sourceReturn = context.input.program.facts.getFact(implementation.declaration, rustSourceCallableReturnFactKey);
      const returned = sourceReturn === undefined ? undefined : rustNativeFutureCallableResult(sourceReturn.returnCarrier);
      if (selectedEffects === undefined || sourceReturn === undefined ||
        asyncFact === undefined && returned === undefined) return undefined;
      nativeInvocations.push({ member, pattern, call, effects: selectedEffects,
        optional: asyncFact === undefined && returned?.optional === true,
        absent: sourceReturn.implementationCompletion === "absence",
      });
      continue;
    }
    const methodFallible = effects.invocation === "fallible";
    const selected = errors.forMember(member);
    if (selected === undefined) return undefined;
    const converted = selected.invocation === undefined ? undefined : errors.invocation.propagate(selected.invocation, call);
    if (selected.invocation !== undefined && converted?.kind !== "try") return undefined;
    const memberCompletion = completion.kind === "selected" ? completion.forMember(member) : undefined;
    if (completion.kind === "selected" && memberCompletion === undefined) return undefined;
    if (memberCompletion?.variant === undefined) {
      arms.push({ pattern, expression: converted?.kind === "try" ? converted.expr :
        methodFallible ? { kind: "call", path: "Ok", args: [call] } : call });
    } else {
      const value: RustExpr = { kind: "associated-call", owner: output, method: memberCompletion.variant,
        args: [converted?.kind === "try" ? { ...converted, nativeReturn: true } : call] };
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
  if (nativeFuture !== undefined && native === undefined) return undefined;
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

function reject(node: Node, context: RustPlanContext): void {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-environment",
    "A generic callable has no complete closed native environment or quantified call contract."));
}
