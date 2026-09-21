import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../analysis/callables/generic-values.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol } from "../../../target-model/types/carriers/generic-callables.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr, RustFunctionParam, RustGenericParameter, RustItem, RustType, RustWherePredicate } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustCurrentErrorBoundary, rustErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { planNativeModuleFunction } from "./functions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

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
  for (const definition of context.input.program.sourceCallableSpecializations.genericValues.definitions) {
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
  const captureNames = implementation.captures.map((_capture, index) => allocateRustSyntheticName(names, `capture_${index}`));
  const bodyContext: RustPlanContext = { ...helperContext, capturedBindings: implementation.captures.map((capture, index) => ({
    declaration: capture.declaration, path: captureNames[index]!, storage: capture.storage, valueCarrier: capture.carrier, borrowed: true,
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
  return [{ kind: "struct", name: implementation.stateName, visibility: "public", derives: [],
    generics: { parameters: environment, wherePredicates: [] }, fields,
  }, { ...helper, generics: rustGenericsWithAssociatedBounds([...parameters, ...helper.generics.parameters],
    helper.generics.wherePredicates),
    params: [...captures.map((type, index): RustFunctionParam => ({
      name: captureNames[index]!, type: { kind: "reference", referent: type!, mutable: false },
    })), ...helper.params],
  }];
}

function planDefinition(definition: RustGenericCallableDefinition, context: RustPlanContext): readonly RustItem[] | undefined {
  const environment = environmentParameters(definition);
  const arguments_ = environment.map(parameter => ({ kind: "type" as const, type: { kind: "named" as const, path: parameter.name } }));
  const signatureCarrier = rustGenericCallableCarrier({ signature: definition.signature,
    environment: environment.map(parameter => ({ kind: "type-parameter", name: parameter.name })),
  });
  const protocol = rustGenericCallableProtocol(signatureCarrier);
  const boundary = rustCurrentErrorBoundary(context);
  if (protocol === undefined || boundary === undefined) return undefined;
  const parameterTypes = protocol.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context));
  const output = rustTypeFromCarrierInContext(protocol.result, context);
  if (parameterTypes.some(type => type === undefined) || output === undefined) return undefined;
  const variants = definition.implementations.map(implementation => {
    const path = rustGenericCallableImplementationPath(implementation, implementation.stateName, context);
    return path === undefined ? undefined : { name: implementation.variantName,
      fields: [{ kind: "named" as const, path, genericArguments: arguments_ }],
    };
  });
  if (variants.some(variant => variant === undefined)) return undefined;
  const predicates = new Map<string, RustWherePredicate>();
  const arms: { pattern: import("../../target-ast/nodes.js").RustPattern; expression: RustExpr }[] = [];
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
    const call: RustExpr = { kind: "call", path,
      genericArguments: [...arguments_, ...definition.signature.typeParameters.map(path => ({ kind: "type" as const, type: { kind: "named" as const, path } }))],
      args: [...implementation.captures.map((_capture, index): RustExpr => ({ kind: "reference",
        expr: { kind: "field", receiver: { kind: "path", path: "environment" }, name: `capture_${index}` },
      })), ...parameterTypes.map((_type, index): RustExpr => ({ kind: "path", path: `argument_${index}` }))],
    };
    arms.push({ pattern: { kind: "tuple-variant", path: `${definition.alternativesName}::${implementation.variantName}`, elements: [{ kind: "binding", name: "environment" }] },
      expression: context.input.program.facts.getFact(implementation.declaration, rustFallibleFactKey) === undefined
        ? { kind: "call", path: "Ok", args: [call] } : call,
    });
  }
  const target: RustType = { kind: "named", path: definition.targetName, genericArguments: arguments_ };
  const state: RustType = { kind: "named", path: definition.alternativesName, genericArguments: arguments_ };
  const generics = { parameters: environment, wherePredicates: [] };
  return [{ kind: "enum", name: definition.alternativesName, visibility: "public", derives: [],
    generics: { parameters: environment, wherePredicates: [] }, variants: variants as NonNullable<typeof variants[number]>[],
  }, { kind: "struct", name: definition.targetName, visibility: "public", derives: [], generics,
    fields: [{ name: "implementation", visibility: "public", type: { kind: "named", path: "alloc::rc::Rc",
      genericArguments: [{ kind: "type", type: state }],
    } }],
  }, { kind: "impl", trait: { kind: "named", path: "Clone" }, target, generics, functions: [{
    name: "clone", visibility: "private", selfParam: { kind: "reference", mutable: false },
    generics: { parameters: [], wherePredicates: [] }, params: [], returnType: { kind: "named", path: "Self" },
    body: { statements: [{ kind: "tail", expr: { kind: "struct-literal", path: "Self", fields: [{ name: "implementation", value: {
      kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: "implementation" }, method: "clone", args: [],
    } }] } }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "PartialEq" }, target, generics, functions: [{
    name: "eq", visibility: "private", selfParam: { kind: "reference", mutable: false },
    generics: { parameters: [], wherePredicates: [] },
    params: [{ name: "other", type: { kind: "reference", referent: { kind: "named", path: "Self" }, mutable: false } }],
    returnType: { kind: "named", path: "bool" },
    body: { statements: [{ kind: "tail", expr: { kind: "call", path: "alloc::rc::Rc::ptr_eq", args: ["self", "other"].map(path => ({
      kind: "reference", expr: { kind: "field", receiver: { kind: "path", path }, name: "implementation" },
    })) } }] },
  }] }, { kind: "impl", trait: { kind: "named", path: "Eq" }, target, generics, functions: [],
  }, { kind: "impl", target, generics: { parameters: environment, wherePredicates: [] }, functions: [{
    name: "call", visibility: "public", selfParam: { kind: "reference", mutable: false },
    generics: { parameters: definition.signature.typeParameters.map(name => ({ kind: "type", name, bounds: [] })),
      wherePredicates: [...predicates.values()],
    }, params: parameterTypes.map((type, index) => ({ name: `argument_${index}`, type: type! })),
    returnType: { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: output }, { kind: "type", type: rustErrorType(boundary) }] },
    body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "method-call",
      receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: "implementation" }, method: "as_ref", args: [],
    }, arms } }] },
  }] }];
}

function environmentParameters(definition: RustGenericCallableDefinition): Extract<RustGenericParameter, { kind: "type" }>[] {
  return definition.signature.environmentParameters.map(name => ({ kind: "type", name, bounds: [] }));
}

function reject(node: Node, context: RustPlanContext): void {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-environment",
    "A generic callable has no complete closed native environment or quantified call contract."));
}
