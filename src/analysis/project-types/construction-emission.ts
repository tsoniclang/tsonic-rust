import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustConstructionProducer } from "../program/records/construction.js";
import type { RustConstructionPreparationSelection, RustConstructionProjection } from "../../target-model/records/construction.js";
import type { RustProjectConstructorSignature } from "../../target-model/types/project-types.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetIdentifier, isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustSourceOptionalTargetType, rustStringTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustConstructionEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly producer: RustConstructionProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const issues: TargetDiagnostic[] = [];
  const parameterRequests = new WeakMap<RustProjectConstructorSignature, Set<string>>();
  const inherited = new Set<RustProjectConstructorSignature>();
  const externalCalls = new Set<Node>();
  for (const definition of program.projectTypes.definitions) {
    const base = program.projectTypes.externalBaseForDefinition(definition);
    if (base !== undefined) input.producer.externalBase(definition, base);
  }
  const contexts = new Map(program.physicalEmissionContexts.contexts.filter(context => context.use.role === "constructor-layer")
    .map(context => [context.use.subject, context]));
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    if (program.records.classDeclaration.get(definition.declaration) === undefined) continue;
    const plan = program.projectConstructions.forDefinition(definition);
    if (plan === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its complete construction readiness plan.", definition.declaration);
    const rejected = [...plan.issues, ...plan.emission.issues];
    if (rejected.length !== 0) {
      for (const issue of rejected) issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: issue.node,
        message: `${issue.reason} Node kind: ${program.source.ast.kindName(issue.node)}.`, evidence: ["target.capability=rust.backend.constructor-readiness"] });
      continue;
    }
    const rootCarrier = program.projectTypes.openCarrier(definition);
    for (const layer of plan.layers) {
      if (layer.constructor === undefined) {
        const relation = program.projectTypes.relationship(rootCarrier, layer.definition);
        if (relation.kind !== "related") failTargetAnalysisInvariant("tsonic-rust", "An inherited construction layer requires its exact native generic relationship.", layer.definition.declaration);
        const key = closedMetadataKey(relation.targetType);
        let requests = parameterRequests.get(layer.signature);
        if (requests === undefined) { requests = new Set(); parameterRequests.set(layer.signature, requests); }
        if (!requests.has(key)) {
          requests.add(key);
          const parameters = layer.signature.parameters.map(parameter => {
            const abi = program.records.sourceParameterAbi.get(parameter.parameterDeclaration);
            const carrier = abi === undefined ? undefined : program.projectTypes.instantiateMemberCarrier(parameter.parameterDeclaration, relation.targetType, abi.parameterCarrier);
            const name = rustTargetIdentifier(parameter.parameterName);
            if (carrier === undefined || !isValidRustIdentifier(name)) failTargetAnalysisInvariant("tsonic-rust", "An inherited effective constructor parameter requires its exact instantiated native ABI and authored name.", parameter.parameterDeclaration);
            return Object.freeze({ declaration: parameter.parameterDeclaration, carrier, name });
          });
          input.producer.parameters(layer.signature, relation.targetType, Object.freeze(parameters));
        }
      }
      const base = program.projectTypes.externalBaseForDefinition(layer.definition);
      if (base === undefined) continue;
      if (layer.baseCall !== undefined) {
        if (externalCalls.has(layer.baseCall)) continue;
        externalCalls.add(layer.baseCall);
        const initialization = program.projectConstructions.externalInitializationForCall(layer.baseCall);
        if (initialization === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted external construction requires its exact selected native argument ABI.", layer.baseCall);
        input.producer.external(layer.baseCall, initialization);
      } else if (!inherited.has(layer.signature)) {
        inherited.add(layer.signature);
        const signature = layer.signature;
        const parameter = signature.parameters[0];
        const abi = parameter === undefined ? undefined : program.records.sourceParameterAbi.get(parameter.parameterDeclaration);
        if (!signature.implicit || signature.declaration === undefined || !base.constructorDeclarations.includes(signature.declaration) ||
          signature.parameters.length !== 1 || parameter === undefined || !parameter.acceptsOmission || parameter.rest || abi?.form !== "optional" ||
          abi.mode !== "value" || !rustTargetTypeRefEquals(abi.parameterCarrier, rustSourceOptionalTargetType(rustStringTargetType())) ||
          !rustTargetTypeRefEquals(abi.valueCarrier, abi.parameterCarrier) || base.fields.some(field => field.initializer.kind === "message" && field.initializer.parameterIndex !== 0))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted inherited external constructor requires its exact optional string ABI.", layer.definition.declaration);
        input.producer.inherited(signature, rustTargetIdentifier(parameter.parameterName));
      }
    }
    const preparations = new Map<Node, RustConstructionPreparationSelection>();
    const retainedReferences = new Set<Node>();
    for (const point of plan.points) {
      const selected = plan.emission.preparationFor(point.node);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted construction point requires its selected preparation.", point.node);
      const physical = contexts.get(selected.layer);
      if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted construction point requires its physical source-layer context.", point.node);
      const projections: RustConstructionProjection[] = selected.projections.map(projection => {
        if (projection.kind === "local" && program.frozenDataWrites.capturesFieldIdentity(projection.declaration, projection.expression.node))
          retainedReferences.add(projection.expression.node);
        if (projection.kind !== "receiver") return projection;
        const carrier = program.physicalEmissionContexts.carrierFor(physical.use, projection.carrier);
        if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted construction receiver requires its physical carrier application.", projection.node);
        return Object.freeze({ ...projection, carrier });
      });
      preparations.set(point.node, Object.freeze({ ...selected, projections: Object.freeze(projections) }));
    }
    const declarations = [...new Set(plan.layers.flatMap(layer => layer.fields.map(field => field.declaration)))];
    input.producer.classDeclaration(definition.declaration, { definition, layers: plan.layers, fields: plan.fields, expressions: plan.expressions,
      points: new Map(plan.points.map(point => [point.node, point])),
      returns: new Map(plan.points.flatMap(point => {
        const layer = plan.returnLayerFor(point.node);
        return layer === undefined ? [] : [[point.node, layer] as const];
      })),
      earlyReturnLayers: new Set(plan.layers.filter(layer => plan.layerHasEarlyReturn(layer.definition)).map(layer => layer.definition)),
      completingLayers: new Set(plan.layers.filter(layer => plan.layerCompletes(layer.definition)).map(layer => layer.definition)),
      unpublishedMutations: new Set(declarations.filter(declaration => plan.mutatesUnpublishedField(declaration))),
      physicalDeclarations: new Map(declarations.map(declaration => [declaration, program.objectRepresentations.receiverCaptures.storageDeclaration(declaration)])),
      retainedFieldIdentities: new Set(plan.fields.filter(field => program.frozenDataWrites.capturesFieldIdentity(field.declaration)).map(field => field.declaration)),
      retainedReferenceIdentities: retainedReferences,
      completesNormally: plan.completesNormally, publishesReceiver: plan.publishesReceiver, mutatesPublishedFields: plan.mutatesPublishedFields,
      emission: Object.freeze({ frame: plan.emission.frame, exposure: plan.emission.exposure, preparations }) });
  }
  return Object.freeze(issues);
}
