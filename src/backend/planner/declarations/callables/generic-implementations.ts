import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol, rustNativeFutureCallableResult } from "../../../../target-model/types/carriers/generic-callables.js";
import { rustLocationTargetType } from "../../../../target-model/types/index.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustSourceCallEffectsFactKey, rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";
import { rustGenericCallableEffectsFactKey } from "../../../../analysis/facts/generic-callable-effects.js";
import type { RustExpr, RustFunctionParam, RustGenericParameter, RustItem, RustPattern, RustType, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput, rustCurrentErrorBoundary, rustErrorType } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustTypeRenderingContext } from "../../types/render.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { planNativeModuleFunction } from "./functions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { genericCallableCopyStateItems, genericCallableStorageItems } from "./generic-storage.js";
import { rustAuthoredTypeParameterNames } from "../../../../target-model/names/type-parameters.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { planRustGenericNativeFutureDispatch, type RustGenericNativeFutureInvocation } from "./generic-native-futures.js";

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
  return rustTypeFromCarrierInContext(capture.storage === "location"
    ? rustLocationTargetType(capture.storageCarrier) : capture.storageCarrier, context);
}

export function rustGenericCallableMarker(definition: RustGenericCallableDefinition, context: RustTypeRenderingContext): RustType {
  const environment: RustType = { kind: "tuple", elements: definition.signature.environmentParameters.map(parameter => ({
    kind: "named", path: context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
  })) };
  return { kind: "named", path: "core::marker::PhantomData", genericArguments: [{ kind: "type", type: {
    kind: "function-pointer", parameters: [environment], result: environment,
  } }] };
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
  const substitutions = new Map(implementation.substitutions);
  const helperContext = rustGeneratedTypeParameterContext(definition.signature.environmentParameters,
    rustAuthoredTypeParameterNames(implementation.declaration, context.input.program.source.ast),
    { ...context, typeParameterSubstitutions: substitutions });
  const captures = implementation.captures.map(capture => rustGenericCallableCaptureType(capture, helperContext));
  if (captures.some(type => type === undefined)) return undefined;
  const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
  const owner = allocateRustSyntheticName(names, "environment");
  const suspended = context.input.program.facts.getFact(implementation.declaration, rustAsyncFunctionFactKey) !== undefined ||
    context.input.program.facts.getFact(implementation.declaration, rustGeneratorFactKey) !== undefined;
  if (suspended && implementation.storage !== "shared" && rustNativeFutureCallableResult(definition.signature.result) === undefined) return undefined;
  const bodyContext: RustPlanContext = { ...helperContext, capturedBindings: implementation.captures.map((capture, index) => ({
    declaration: capture.declaration, expression: { kind: "reference", expr: {
      kind: "field", receiver: { kind: "path", path: owner }, name: `capture_${index}`,
    } },
    storage: capture.storage, valueCarrier: capture.carrier, borrowed: "shared",
  })) };
  const helper = planNativeModuleFunction(implementation.declaration, implementation.declaration,
    implementation.functionName, true, bodyContext);
  if (helper?.kind !== "function") return undefined;
  const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
  if (contract === undefined) return undefined;
  const environment = environmentParameters(definition, helperContext);
  const parameters = environment.map((parameter, index) => {
    const identity = definition.signature.environmentParameters[index]!.identity;
    const original = implementation.substitutions.find(([_identity, type]) => type.kind === "type-parameter" && type.identity === identity)?.[0];
    const requirements = contract.capturedTypeParameters.find(parameter => parameter.identity === original)?.requirements ?? [];
    return { ...parameter, bounds: rustGenericRequirementBounds(requirements) };
  });
  const fields = implementation.captures.map((_capture, index) => ({
    name: `capture_${index}`, type: captures[index]!, visibility: "public" as const,
  }));
  if (environment.length > 0) fields.push({ name: "marker", type: rustGenericCallableMarker(definition, helperContext), visibility: "public" });
  const generics = { parameters: environment, wherePredicates: [] };
  const state: RustType = { kind: "named", path: implementation.stateName,
    genericArguments: environment.map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })),
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

function planDefinition(definition: RustGenericCallableDefinition, context: RustPlanContext): readonly RustItem[] | undefined {
  const environment = environmentParameters(definition, context);
  const arguments_ = environment.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }));
  const signatureCarrier = rustGenericCallableCarrier({ origin: definition.origin, signature: definition.signature,
    environment: definition.signature.environmentParameters,
  });
  const protocol = rustGenericCallableProtocol(signatureCarrier);
  const boundary = rustCurrentErrorBoundary(context);
  const effects = context.input.program.facts.getFact(definition.implementations[0]!.declaration, rustGenericCallableEffectsFactKey);
  if (protocol === undefined || effects === undefined ||
      (effects.invocation === "fallible" || effects.awaiting === "fallible") && boundary === undefined) return undefined;
  const nativeFuture = rustNativeFutureCallableResult(protocol.result);
  const payload = nativeFuture?.output ?? protocol.result;
  const parameterTypes = protocol.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context));
  const output = rustTypeFromCarrierInContext(payload, context);
  if (parameterTypes.some(type => type === undefined) || output === undefined) return undefined;
  const variants = definition.implementations.map(implementation => {
    const path = rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
    const state: RustType = { kind: "named", path: path ?? "", genericArguments: arguments_ };
    return path === undefined ? undefined : { name: implementation.variantName,
      fields: [implementation.storage === "shared" ? shared(state) : state],
    };
  });
  if (variants.some(variant => variant === undefined)) return undefined;
  const predicates = new Map<string, RustWherePredicate>();
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  const nativeInvocations: RustGenericNativeFutureInvocation[] = [];
  for (const implementation of definition.implementations) {
    const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
    const source = context.input.program.sourceLifetimes.contractFor(implementation.declaration);
    const sourceParameters = source?.parameters ?? (context.input.program.source.ast.typeParameters(implementation.declaration).length === 0 ? [] : undefined);
    const path = rustGenericCallableImplementationPath(implementation, implementation.functionName, context);
    if (contract === undefined || sourceParameters === undefined || path === undefined ||
      sourceParameters.length !== definition.signature.typeParameters.length || sourceParameters.some(parameter => parameter.kind !== "type")) return undefined;
    const substitutions = new Map(implementation.substitutions);
    for (const [index, parameter] of sourceParameters.entries()) {
      if (parameter.kind !== "type") return undefined;
      substitutions.set(parameter.identity, definition.signature.typeParameters[index]!);
    }
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
    const call: RustExpr = { kind: "call", path,
      genericArguments: [...arguments_, ...definition.signature.typeParameters.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }))],
      args: [...(implementation.captures.length === 0 ? [] : [ownerArgument]),
        ...parameterTypes.map((_type, index): RustExpr => ({ kind: "path", path: `argument_${index}` }))],
    };
    const pattern: RustPattern = { kind: "tuple-variant", path: `Self::${implementation.variantName}`,
      elements: [implementation.captures.length === 0 ? { kind: "wildcard" } : { kind: "binding", name: "environment" }] };
    if (nativeFuture !== undefined) {
      const selectedEffects = context.input.program.facts.getFact(implementation.declaration, rustSourceCallEffectsFactKey);
      const sourceReturn = context.input.program.facts.getFact(implementation.declaration, rustSourceCallableReturnFactKey);
      const returned = sourceReturn === undefined ? undefined : rustNativeFutureCallableResult(sourceReturn.returnCarrier);
      if (selectedEffects === undefined || sourceReturn === undefined ||
        asyncFact === undefined && returned === undefined) return undefined;
      nativeInvocations.push({ implementation, pattern, call, effects: selectedEffects,
        optional: asyncFact === undefined && returned?.optional === true,
        absent: sourceReturn.implementationCompletion === "absence",
      });
      continue;
    }
    const methodFallible = effects.invocation === "fallible";
    const implementationFallible = !suspended &&
      context.input.program.facts.getFact(implementation.declaration, rustFallibleFactKey) !== undefined;
    if (implementationFallible && !methodFallible) return undefined;
    arms.push({ pattern,
      expression: methodFallible && !implementationFallible ? { kind: "call", path: "Ok", args: [call] } : call,
    });
  }
  const target: RustType = { kind: "named", path: definition.targetName, genericArguments: arguments_ };
  const generics = { parameters: environment, wherePredicates: [] };
  const methodFallible = effects.invocation === "fallible";
  const methodOutput: RustType = methodFallible
    ? { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: output }, { kind: "type", type: rustErrorType(boundary!) }] }
    : output;
  const dispatch: RustExpr = { kind: "match", expression: { kind: "path", path: "self" }, arms };
  const native = nativeFuture === undefined ? undefined : planRustGenericNativeFutureDispatch({
    definition, output, effects, optional: nativeFuture.optional,
    ...(boundary === undefined ? {} : { error: rustErrorType(boundary) }),
    captures: [...environment.map(parameter => ({ kind: "named" as const, path: parameter.name })),
      ...definition.signature.typeParameters.map(parameter => ({ kind: "named" as const, path: parameter.name }))],
    invocations: nativeInvocations,
  });
  if (nativeFuture !== undefined && native === undefined) return undefined;
  return [...genericCallableStorageItems(definition, generics, target, variants as NonNullable<typeof variants[number]>[]),
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

function environmentParameters(definition: RustGenericCallableDefinition, context: RustTypeRenderingContext): Extract<RustGenericParameter, { kind: "type" }>[] {
  return definition.signature.environmentParameters.map(parameter => ({ kind: "type",
    name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name, bounds: [] }));
}

function reject(node: Node, context: RustPlanContext): void {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-environment",
    "A generic callable has no complete closed native environment or quantified call contract."));
}
