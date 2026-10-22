import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { rustLocationTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustVecTargetType } from "../../../target-model/types/carriers/native.js";

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
  for (const node of nodes) {
    collect(program.records.nativeDeclaration.get(node));
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
