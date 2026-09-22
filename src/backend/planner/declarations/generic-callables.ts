import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../analysis/callables/generic-values.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFutureOutputCarrier, rustFutureTargetId, rustLocationTargetType } from "../../../target-model/types/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey } from "../../../analysis/facts/keys.js";
import { rustGenericCallableEffectsFactKey } from "../../../analysis/facts/generic-callable-effects.js";
import type { RustExpr, RustFunctionParam, RustGenericParameter, RustItem, RustPattern, RustType, RustWherePredicate } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustCurrentErrorBoundary, rustErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../types/project-projection-bounds.js";
import { planNativeModuleFunction } from "./functions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { genericCallableCopyStateItems, genericCallableStorageItems } from "./generic-callable-storage.js";

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

export function rustGenericCallableMarker(definition: RustGenericCallableDefinition): RustType {
  const environment: RustType = { kind: "tuple", elements: definition.signature.environmentParameters.map(path => ({ kind: "named", path })) };
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
  const helperContext = { ...context, typeParameterSubstitutions: substitutions };
  const captures = implementation.captures.map(capture => rustGenericCallableCaptureType(capture, helperContext));
  if (captures.some(type => type === undefined)) return undefined;
  const names = createRustSyntheticNameState(context.input.program.source.ast, implementation.declaration, []);
  const owner = allocateRustSyntheticName(names, "environment");
  const suspended = context.input.program.facts.getFact(implementation.declaration, rustAsyncFunctionFactKey) !== undefined ||
    context.input.program.facts.getFact(implementation.declaration, rustGeneratorFactKey) !== undefined;
  if (suspended && definition.storage !== "shared") return undefined;
  const bodyContext: RustPlanContext = { ...helperContext, capturedBindings: implementation.captures.map((capture, index) => ({
    declaration: capture.declaration, expression: { kind: "field", receiver: { kind: "path", path: owner }, name: `capture_${index}` },
    storage: capture.storage, valueCarrier: capture.carrier, borrowed: true,
  })) };
  const helper = planNativeModuleFunction(implementation.declaration, implementation.declaration,
    implementation.functionName, true, bodyContext);
  if (helper?.kind !== "function") return undefined;
  const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
  if (contract === undefined) return undefined;
  const environment = environmentParameters(definition);
  const parameters = environment.map(parameter => {
    const original = implementation.substitutions.find(([_name, type]) => type.kind === "type-parameter" && type.name === parameter.name)?.[0];
    const requirements = contract.capturedTypeParameters.find(parameter => parameter.name === original)?.requirements ?? [];
    return { ...parameter, bounds: rustGenericRequirementBounds(requirements) };
  });
  if (parameters.some(parameter => helper.generics.parameters.some(candidate => candidate.name === parameter.name))) return undefined;
  const fields = implementation.captures.map((_capture, index) => ({
    name: `capture_${index}`, type: captures[index]!, visibility: "public" as const,
  }));
  if (environment.length > 0) fields.push({ name: "marker", type: rustGenericCallableMarker(definition), visibility: "public" });
  const generics = { parameters: environment, wherePredicates: [] };
  const state: RustType = { kind: "named", path: implementation.stateName,
    genericArguments: environment.map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })),
  };
  const ownerParams: readonly RustFunctionParam[] = captures.length === 0 ? [] : [{ name: owner,
    type: suspended ? shared(state) : { kind: "reference", referent: state, mutable: false },
  }];
  return [{ kind: "struct", name: implementation.stateName, visibility: "public", derives: [],
    generics, fields,
  }, ...(definition.storage === "value" ? genericCallableCopyStateItems(state, generics) : []),
  { ...helper, generics: rustGenericsWithAssociatedBounds([...parameters, ...helper.generics.parameters],
    helper.generics.wherePredicates),
    params: [...ownerParams, ...helper.params],
  }];
}

function planDefinition(definition: RustGenericCallableDefinition, context: RustPlanContext): readonly RustItem[] | undefined {
  const environment = environmentParameters(definition);
  const arguments_ = environment.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }));
  const signatureCarrier = rustGenericCallableCarrier({ origin: definition.origin, signature: definition.signature,
    environment: environment.map(parameter => ({ kind: "type-parameter", name: parameter.name })),
  });
  const protocol = rustGenericCallableProtocol(signatureCarrier);
  const boundary = rustCurrentErrorBoundary(context);
  const effects = context.input.program.facts.getFact(definition.implementations[0]!.declaration, rustGenericCallableEffectsFactKey);
  if (protocol === undefined || effects === undefined ||
      (effects.invocation === "fallible" || effects.awaiting === "fallible") && boundary === undefined) return undefined;
  const nativeFuture = protocol.result.kind === "target-named" && protocol.result.id === rustFutureTargetId;
  const payload = nativeFuture ? rustFutureOutputCarrier(protocol.result) : protocol.result;
  const parameterTypes = protocol.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context));
  const output = rustTypeFromCarrierInContext(payload, context);
  if (parameterTypes.some(type => type === undefined) || output === undefined) return undefined;
  const variants = definition.implementations.map(implementation => {
    const path = rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
    const state: RustType = { kind: "named", path: path ?? "", genericArguments: arguments_ };
    return path === undefined ? undefined : { name: implementation.variantName,
      fields: [definition.storage === "shared" ? shared(state) : state],
    };
  });
  if (variants.some(variant => variant === undefined)) return undefined;
  const predicates = new Map<string, RustWherePredicate>();
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  for (const implementation of definition.implementations) {
    const contract = context.input.program.declarationGenericRequirements.contractFor(implementation.declaration);
    const source = context.input.program.sourceLifetimes.contractFor(implementation.declaration);
    const path = rustGenericCallableImplementationPath(implementation, implementation.functionName, context);
    if (contract === undefined || source === undefined || path === undefined ||
      source.parameters.length !== definition.signature.typeParameters.length || source.parameters.some(parameter => parameter.kind !== "type")) return undefined;
    const substitutions = new Map(implementation.substitutions);
    for (const [index, parameter] of source.parameters.entries()) {
      if (parameter.kind !== "type") return undefined;
      substitutions.set(parameter.targetName, { kind: "type-parameter", name: definition.signature.typeParameters[index]! });
    }
    for (const parameter of [...contract.typeParameters, ...contract.capturedTypeParameters]) {
      const type = substitutions.get(parameter.name);
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
    if (nativeFuture && asyncFact?.kind !== "native-future") return undefined;
    const owner: RustExpr = { kind: "path", path: "environment" };
    const ownerArgument: RustExpr = suspended
      ? nativeFuture ? owner : { kind: "method-call", receiver: owner, method: "clone", args: [] }
      : definition.storage === "shared" ? { kind: "method-call", receiver: owner, method: "as_ref", args: [] } : owner;
    const call: RustExpr = { kind: "call", path,
      genericArguments: [...arguments_, ...definition.signature.typeParameters.map(path => ({ kind: "type" as const, type: { kind: "named" as const, path } }))],
      args: [...(implementation.captures.length === 0 ? [] : [ownerArgument]),
        ...parameterTypes.map((_type, index): RustExpr => ({ kind: "path", path: `argument_${index}` }))],
    };
    const result: RustExpr = nativeFuture ? { kind: "await", expr: call } : call;
    const methodFallible = (nativeFuture ? effects.awaiting : effects.invocation) === "fallible";
    const implementationFallible = (!suspended || nativeFuture) &&
      context.input.program.facts.getFact(implementation.declaration, rustFallibleFactKey) !== undefined;
    if (implementationFallible && !methodFallible) return undefined;
    arms.push({ pattern: { kind: "tuple-variant", path: `Self::${implementation.variantName}`,
      elements: [implementation.captures.length === 0 ? { kind: "wildcard" } : { kind: "binding", name: "environment" }] },
      expression: methodFallible && !implementationFallible ? { kind: "call", path: "Ok", args: [result] } : result,
    });
  }
  const target: RustType = { kind: "named", path: definition.targetName, genericArguments: arguments_ };
  const generics = { parameters: environment, wherePredicates: [] };
  const methodFallible = (nativeFuture ? effects.awaiting : effects.invocation) === "fallible";
  const methodOutput: RustType = methodFallible
    ? { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: output }, { kind: "type", type: rustErrorType(boundary!) }] }
    : output;
  const dispatch: RustExpr = { kind: "match", expression: { kind: "path", path: nativeFuture ? "owner" : "self" }, arms };
  const resultType: RustType = nativeFuture ? { kind: "impl-trait", bounds: [{ kind: "trait-type", reference: {
    trait: { kind: "named", path: "core::future::Future", genericArguments: [{ kind: "associated-equality", name: "Output", genericArguments: [], type: methodOutput }] },
  } }], outlives: [], captures: [{ kind: "type", type: { kind: "named", path: "Self" } },
    ...arguments_, ...definition.signature.typeParameters.map(path => ({ kind: "type" as const, type: { kind: "named" as const, path } }))] } : methodOutput;
  return [...genericCallableStorageItems(definition, generics, target, variants as NonNullable<typeof variants[number]>[]),
  { kind: "impl", target, generics, functions: [{
    name: "call", visibility: "public", selfParam: { kind: "reference", mutable: false },
    generics: { parameters: definition.signature.typeParameters.map(name => ({ kind: "type", name, bounds: [] })),
      wherePredicates: [...predicates.values()],
    }, params: parameterTypes.map((type, index) => ({ name: `argument_${index}`, type: type! })),
    returnType: resultType,
    body: { statements: nativeFuture ? [{ kind: "let", name: "owner", mutable: false,
      init: { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "clone", args: [] },
    }, { kind: "tail", expr: { kind: "invoke", callee: { kind: "closure-block", params: [], move: true, async: true,
      body: { statements: [{ kind: "tail", expr: dispatch }] },
    }, args: [] } }] : [{ kind: "tail", expr: dispatch }] },
  }] }];
}

function shared(type: RustType): RustType {
  return { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}

function environmentParameters(definition: RustGenericCallableDefinition): Extract<RustGenericParameter, { kind: "type" }>[] {
  return definition.signature.environmentParameters.map(name => ({ kind: "type", name, bounds: [] }));
}

function reject(node: Node, context: RustPlanContext): void {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-environment",
    "A generic callable has no complete closed native environment or quantified call contract."));
}
