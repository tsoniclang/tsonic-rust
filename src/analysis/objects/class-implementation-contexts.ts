import type { Node } from "@tsonic/tsts";
import { authoredTypeParameterNames, generatedTypeParameterNames } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustClassEmissionProducer } from "../program/records/class-emission.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { RustClassImplementationContext } from "../../target-model/records/class-implementations.js";

export interface RustClassImplementationContextConstruction {
  forInstance(definition: RustProjectTypeDefinition, carrier: TargetTypeRef): RustClassImplementationContext;
  seal(): void;
}

export function prepareRustClassImplementationContexts(
  program: Pick<RustAnalysisProgram, "projectTypes" | "classValues"> & {
    readonly source: Pick<RustAnalysisProgram["source"], "ast">;
    readonly records: Pick<RustAnalysisProgram["records"], "runtimeCarrier">;
  },
  producer: Pick<RustClassEmissionProducer, "implementationContext">,
  nodes: readonly Node[],
): RustClassImplementationContextConstruction {
  const contexts = new WeakMap<Node, Map<string, RustClassImplementationContext>>();
  let sealed = false;
  const forInstance = (definition: RustProjectTypeDefinition, carrier: TargetTypeRef): RustClassImplementationContext => {
    const key = closedMetadataKey(carrier);
    const instances = contexts.get(definition.declaration) ?? new Map<string, RustClassImplementationContext>();
    const existing = instances.get(key);
    if (existing !== undefined) return existing;
    if (sealed) failTargetAnalysisInvariant("tsonic-rust",
      "A sealed class implementation context cannot admit a new native instance.", definition.declaration);
    if (program.projectTypes.definitionForCarrier(carrier) !== definition ||
      program.projectTypes.definitionForDeclaration(definition.declaration) !== definition)
      failTargetAnalysisInvariant("tsonic-rust",
        "A native class implementation context requires its exact original carrier owner.", definition.declaration);
    const arguments_ = rustSourceTypeCarrierValue(carrier)?.genericArguments;
    if (arguments_ === undefined || arguments_.length !== definition.genericParameters.length)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted class implementation requires its exact native generic correspondence.", definition.declaration);
    const types = new Map<string, TargetTypeRef>();
    const lifetimes = new Map<string, RustLifetimeRef>();
    for (const [index, parameter] of definition.genericParameters.entries()) {
      const argument = arguments_[index];
      if (parameter.kind === "type" && argument?.kind === "type") types.set(parameter.identity, argument.type);
      else if (parameter.kind === "lifetime" && argument?.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      else failTargetAnalysisInvariant("tsonic-rust", "An admitted class implementation requires exact native generic argument kinds.", definition.declaration);
    }
    const value = Object.freeze({
      types: snapshotTargetReadonlyMap(types), lifetimes: snapshotTargetReadonlyMap(lifetimes),
      names: snapshotTargetReadonlyMap(generatedTypeParameterNames(rustTargetGenericReferences(carrier).typeParameters,
        authoredTypeParameterNames(definition.declaration, program.source.ast, new Set(definition.typeParameterIdentities)))) });
    producer.implementationContext(definition.declaration, carrier, value);
    instances.set(key, value);
    contexts.set(definition.declaration, instances);
    return value;
  };
  for (const view of [...program.classValues.constructorViewImplementations, ...program.classValues.instanceViewImplementations]) {
    const definition = program.projectTypes.definitionForDeclaration(view.declaration);
    if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted class implementation requires its exact source declaration owner.", view.declaration);
    forInstance(definition, view.sourceCarrier);
  }
  const pending = [...program.projectTypes.definitions.map(definition => program.projectTypes.openCarrier(definition)),
    ...program.classValues.instanceViewImplementations.map(view => view.sourceCarrier),
    ...program.classValues.constructorViewImplementations.map(view => view.sourceCarrier)];
  for (const node of nodes) {
    const carrier = program.records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) pending.push(carrier);
  }
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    const definition = program.projectTypes.definitionForCarrier(carrier);
    if (definition === undefined) continue;
    forInstance(definition, carrier);
    pending.push(...program.projectTypes.directSupertypes(carrier) ?? []);
  }
  return Object.freeze({ forInstance, seal() { sealed = true; } });
}
