import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustLocationTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustVecTargetType } from "../../../target-model/types/carriers/native.js";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustCapturedLifetimeSubstitutions } from "../../../target-model/names/captured-lifetimes.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";

/**
 * The carriers that declaration-level and binding-level emission records hand to the planner: generated union payload
 * templates, structural shape storage and accessors, native type aliases, lexical function capture environments, local
 * binding storage, binding-pattern projections (element storage and defaults), source call argument destinations and
 * optional storage call arguments, frame callable bindings, lambda bodies, project callable adapters and native closure
 * bodies (construction, body, physical and invocation-error carriers). Every one needs sealed type emission metadata
 * before planning, including the storage wrappers the planner composes from them (location cells and rest vectors).
 */
export function rustDeclarationEmissionCarriers(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[]): readonly TargetTypeRef[] {
  const carriers: TargetTypeRef[] = [];
  const visited = new WeakSet<object>();
  const collect = (value: unknown): void => {
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const element of value) collect(element);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (value instanceof Map) {
      for (const element of value.values()) collect(element);
      return;
    }
    // Only record data is walked; source syntax and checker objects are class instances and carry no carriers.
    if (prototype !== Object.prototype && prototype !== null) return;
    if (isRustTargetTypeRef(value)) {
      carriers.push(value);
      return;
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (record["storage"] === "location") {
      const stored = isRustTargetTypeRef(record["valueCarrier"]) ? record["valueCarrier"]
        : isRustTargetTypeRef(record["carrier"]) ? record["carrier"] : undefined;
      if (stored !== undefined) carriers.push(rustLocationTargetType(stored));
    }
    if (record["kind"] === "rest" && isRustTargetTypeRef(record["elementCarrier"])) carriers.push(rustVecTargetType(record["elementCarrier"]));
    for (const field of Object.values(record)) collect(field);
  };
  for (const union of program.structuralShapes.unionDefinitions) collect(union.payloadTemplate);
  for (const definition of new Set([...program.structuralShapes.definitions, ...program.structuralShapes.instances]))
    collect(program.records.structuralShapeEmission.get(definition));
  for (const sourceFile of program.sourceFiles) collect(program.records.frameDeclarations.get(sourceFile));
  for (const selected of program.classValues.instanceViewImplementations)
    collect(program.records.structuralViewImplementations.get(selected.declaration, selected.ownerFileName));
  for (const node of nodes) {
    const completion = program.records.deferredProducerEffects.get(node);
    if (completion?.kind === "futures" && program.callableValues.nativeProducers.forDeclaration(node) !== undefined) {
      for (const [ordinal] of completion.channels.entries()) {
        const error = program.callableValues.nativeProducers.errorFor(node, ordinal);
        if (error === undefined) failTargetAnalysisInvariant("tsonic-rust",
          "An admitted deferred producer channel requires its published native error identity.", node);
        collect(error);
      }
    }
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "provider-record-literal" || operation?.kind === "source-conversion") collect(operation);
    collect(program.records.contextualValueConversion.get(node));
    collect(program.records.nativeDeclaration.get(node));
    collect(program.records.nativeClass.get(node));
    collect(program.records.lexicalFunction.get(node));
    collect(program.records.localBinding.get(node));
    collect(program.records.projectCallableAdapters.get(node));
    collect(program.records.lambdaBody.get(node));
    collect(program.records.bindingProjection.get(node));
    collect(program.records.bindingProjectionEmission.get(node));
    collect(program.records.sourceCallEvaluation.get(node));
    collect(program.records.optionalStorageCallArguments.get(node));
  }
  return carriers;
}

/**
 * Inside a callable that captures outer lifetimes, the planner renders every carrier with those lifetimes renamed apart
 * from the callable's own lifetime parameters (rustCapturedLifetimeSubstitutions, composed from the outermost enclosing
 * callable inwards). Those renamed carriers need their own type emission evidence.
 */
export function rustCapturedLifetimeEmissionCarriers(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], carriersFor: (node: Node) => readonly TargetTypeRef[]): readonly TargetTypeRef[] {
  const { ast } = program.source;
  const scopes = new Map<Node, ReadonlyMap<string, RustLifetimeRef>>();
  const scopeFor = (callable: Node | undefined): ReadonlyMap<string, RustLifetimeRef> => {
    if (callable === undefined) return new Map();
    const existing = scopes.get(callable);
    if (existing !== undefined) return existing;
    const substitutions = new Map(scopeFor(sourceEnclosingCallable(ast.parent(callable), ast)));
    const native = program.records.nativeGenerics.get(callable);
    if (native !== undefined) {
      for (const parameter of native.sourceContract.parameters)
        if (parameter.kind === "lifetime") substitutions.delete(rustLifetimeKey(parameter.lifetime));
      const captured = [...program.records.lexicalFunction.get(callable)?.genericParameters ?? [], ...native.implicitLifetimes];
      for (const [key, lifetime] of rustCapturedLifetimeSubstitutions(native.sourceContract.parameters, captured))
        substitutions.set(key, lifetime);
    }
    scopes.set(callable, substitutions);
    return substitutions;
  };
  const carriers: TargetTypeRef[] = [];
  for (const node of nodes) {
    const substitutions = scopeFor(program.records.nativeGenerics.get(node) !== undefined ? node : sourceEnclosingCallable(node, ast));
    if (substitutions.size === 0) continue;
    for (const carrier of carriersFor(node)) {
      const substituted = substituteRustTargetGenerics(carrier, new Map(), substitutions, new Map());
      // Equality compares lifetimes by identity; the renamed carrier differs only in its rendered lifetime names.
      if (closedMetadataKey(substituted) !== closedMetadataKey(carrier)) carriers.push(substituted);
    }
  }
  return carriers;
}
