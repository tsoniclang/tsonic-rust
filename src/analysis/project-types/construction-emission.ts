import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectConstructionPlan } from "./construction-plan.js";
import type { RustConstructionProducer } from "../program/records/objects/construction.js";
import type { RustConstructionPreparationSelection, RustConstructionProjection } from "../../target-model/records/objects/construction.js";
import type { RustProjectConstructorSignature, RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
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
  const parametersFor = (signature: RustProjectConstructorSignature, receiver: TargetTypeRef): void => {
    const key = closedMetadataKey(receiver);
    let requests = parameterRequests.get(signature);
    if (requests === undefined) { requests = new Set(); parameterRequests.set(signature, requests); }
    if (requests.has(key)) return;
    requests.add(key);
    const parameters = signature.parameters.map(parameter => {
      const abi = program.records.sourceParameterAbi.get(parameter.parameterDeclaration);
      const carrier = abi === undefined ? undefined : program.projectTypes.instantiateMemberCarrier(parameter.parameterDeclaration, receiver, abi.parameterCarrier);
      const name = rustTargetIdentifier(parameter.parameterName);
      if (carrier === undefined || !isValidRustIdentifier(name)) failTargetAnalysisInvariant("tsonic-rust",
        "An inherited effective constructor parameter requires its exact instantiated native ABI and authored name.", parameter.parameterDeclaration);
      return Object.freeze({ declaration: parameter.parameterDeclaration, carrier, name });
    });
    input.producer.parameters(signature, receiver, Object.freeze(parameters));
  };
  for (const definition of program.projectTypes.definitions) {
    const base = program.projectTypes.externalBaseForDefinition(definition);
    if (base !== undefined) input.producer.externalBase(definition, base);
  }
  const contexts = new Map(program.physicalEmissionContexts.contexts.filter(context => context.use.role === "constructor-layer")
    .map(context => [context.use.subject, context]));
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    if (program.records.classDeclaration.get(definition.declaration) === undefined) continue;
    for (const signature of program.projectTypes.constructorsForDefinition(definition))
      if (signature.implicit) parametersFor(signature, program.projectTypes.openCarrier(definition));
    // An abstract class is never constructed itself; its layers are prepared within each concrete subclass, and the
    // emission contexts request no constructor layer for it.
    if (program.source.ast.hasModifierKind(definition.declaration, "abstract")) continue;
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
        parametersFor(layer.signature, relation.targetType);
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
    // An abstract class is never constructed on its own: its constructor runs only as a layer of a concrete
    // subclass's construction, which prepares those points with its own physical layer contexts.
    const constructible = !program.source.ast.hasModifierKind(definition.declaration, "abstract");
    for (const point of constructible ? plan.points : []) {
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
    const localFieldDeclarations = new Set(plan.fields.filter(field => {
      const binding = program.records.frameBindingDeclaration.get(field.declaration);
      const deferred = binding !== undefined ? binding.initialization === "deferred"
        : program.records.capturedFieldStorage.get(field.declaration)?.storage.initialization === "deferred";
      return !deferred && !plan.layerHasEarlyReturn(field.owner) &&
        (field.initializer !== undefined || field.externallyInitialized);
    }).map(field => field.declaration));
    const mutableInLayer = (declaration: Node, layer: RustProjectTypeDefinition | undefined): boolean => {
      const binding = program.records.frameBindingDeclaration.get(declaration);
      if (binding !== undefined) return binding.storage === "value" && plan.mutatesUnpublishedField(declaration, layer);
      if (program.records.capturedFieldStorage.get(declaration) !== undefined) return false;
      if (plan.mutatesUnpublishedField(declaration, layer)) return true;
      if (!plan.accessesUnpublishedField(declaration, layer)) return false;
      const dispatch = program.records.projectFieldDispatch.get(declaration);
      if (dispatch === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An accessed construction field requires its exact native content-mutation disposition.", declaration);
      return dispatch.mutableContent;
    };
    const mutableFieldLocals = new Map<RustProjectTypeDefinition | undefined, ReadonlySet<Node>>();
    mutableFieldLocals.set(undefined, new Set(plan.fields.filter(field => mutableInLayer(field.declaration,
      localFieldDeclarations.has(field.declaration) ? field.owner : undefined)).map(field => field.declaration)));
    for (const [index, layer] of plan.layers.entries()) {
      const next = plan.layers[index + 1];
      mutableFieldLocals.set(layer.definition, new Set(next === undefined ? [] : plan.fields
        .filter(field => localFieldDeclarations.has(field.declaration) && mutableInLayer(field.declaration, next.definition))
        .map(field => field.declaration)));
    }
    const root = plan.layers.find(layer => layer.definition === definition);
    if (root === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted construction requires its exact native root layer.", definition.declaration);
    const body = root.constructor === undefined ? undefined : program.source.ast.body(root.constructor);
    const sourceExit = body === undefined ? undefined : program.records.statementExit.get(body);
    if (body !== undefined && sourceExit === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted construction requires its completed source body exit.", body);
    const canFallThrough = plan.completesNormally &&
      (body === undefined || sourceExit === false || plan.layerHasEarlyReturn(definition));
    input.producer.classDeclaration(definition.declaration, { definition, layers: plan.layers, fields: plan.fields, expressions: plan.expressions,
      points: new Map(plan.points.map(point => [point.node, point])),
      returns: new Map(plan.points.flatMap(point => {
        const layer = plan.returnLayerFor(point.node);
        return layer === undefined ? [] : [[point.node, layer] as const];
      })),
      earlyReturnLayers: new Set(plan.layers.filter(layer => plan.layerHasEarlyReturn(layer.definition)).map(layer => layer.definition)),
      completingLayers: new Set(plan.layers.filter(layer => plan.layerCompletes(layer.definition)).map(layer => layer.definition)),
      localFieldDeclarations, mutableFieldLocals,
      unobservedInitializers: new Set(plan.fields.filter(field => (field.initializer !== undefined || field.externallyInitialized) &&
        !plan.observesInitialValue(field.declaration)).map(field => field.declaration)),
      physicalDeclarations: new Map(declarations.map(declaration => [declaration, program.objectRepresentations.receiverCaptures.storageDeclaration(declaration)])),
      retainedFieldIdentities: new Set(plan.fields.filter(field => program.frozenDataWrites.capturesFieldIdentity(field.declaration)).map(field => field.declaration)),
      retainedReferenceIdentities: retainedReferences,
      completesNormally: plan.completesNormally, publishesReceiver: plan.publishesReceiver,
      mutableReceiver: constructionReceiverNeedsMutableBinding(program, plan, preparations),
      emission: Object.freeze({ frame: plan.emission.frame, exposure: plan.emission.exposure, preparations, canFallThrough }) });
  }
  return Object.freeze(issues);
}

function constructionReceiverNeedsMutableBinding(program: Omit<RustAnalysisProgram, "reachability">,
  plan: RustProjectConstructionPlan, preparations: ReadonlyMap<Node, RustConstructionPreparationSelection>): boolean {
  if (!plan.publishesReceiver) return false;
  const representation = program.objectRepresentations.representationFor(plan.definition);
  if (representation === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "A published construction receiver requires its exact native representation.", plan.definition.declaration);
  if (representation.kind !== "value") return false;
  const { ast } = program.source;
  for (const preparation of preparations.values()) for (const projection of preparation.projections) {
    if (projection.kind !== "receiver") continue;
    const expression = projection.expression;
    const operation = program.records.targetOperation.get(expression.node);
    if (expression.kind !== "receiver" && (operation?.kind !== "source-field" || operation.storage !== "project-object" ||
      operation.valueSemantics.kind !== "stored" || operation.declaration === undefined ||
      program.objectRepresentations.receiverCaptures.storageDeclaration(operation.declaration) !== expression.declaration))
      failTargetAnalysisInvariant("tsonic-rust", "A published construction field requires its exact admitted physical declaration.", expression.node);
    if (expression.declaration !== undefined &&
      (program.records.frameBindingDeclaration.get(expression.declaration) !== undefined ||
        program.records.capturedFieldStorage.get(expression.declaration) !== undefined)) continue;
    if (expression.kind !== "receiver" && operation?.kind === "source-field" && operation.accessMode !== "read") {
      const storage = program.records.storedField.get(operation.storage, operation.receiverCarrier, operation.storageIndex);
      if (storage === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A published construction field write requires its admitted native storage.", expression.node);
      if (storage.path !== undefined && storage.dispatch === undefined) return true;
      if (storage.dispatch?.plan.write === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A published construction field write requires its exact native write role.", expression.node);
    }
    const read = program.ownership.reads.get(expression.node)?.source;
    if (read === undefined && (expression.kind === "receiver" || operation?.kind === "source-field" && operation.accessMode !== "write"))
      failTargetAnalysisInvariant("tsonic-rust", "A published construction expression requires its exact native use role.", expression.node);
    if (read?.kind === "borrow" && read.mutable) return true;
    if (expression.kind !== "receiver") continue;
    let receiver = expression.node;
    let parent = ast.parent(receiver);
    while (parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === receiver) {
      receiver = parent;
      parent = ast.parent(receiver);
    }
    if (parent === undefined) continue;
    const selectedReceiver = program.records.accessorReceiver.get(parent);
    if (selectedReceiver?.receiver !== receiver) continue;
    if (!selectedReceiver.value) failTargetAnalysisInvariant("tsonic-rust",
      "A value construction accessor requires its actual native receiver representation.", parent);
    const accessor = program.records.targetOperation.get(parent);
    if (accessor?.kind !== "source-accessor" || accessor.receiver.kind !== "instance")
      failTargetAnalysisInvariant("tsonic-rust", "A native construction accessor requires its selected instance operation.", parent);
    const methods: Node[] = [];
    if (accessor.accessMode !== "write") {
      if (accessor.read === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A native construction accessor read requires its admitted declaration.", parent);
      methods.push(accessor.read.declaration);
    }
    if (accessor.accessMode !== "read") {
      if (accessor.write === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A native construction accessor write requires its admitted declaration.", parent);
      methods.push(accessor.write.declaration);
    }
    for (const method of methods) {
      const mode = program.records.selfMode.get(method);
      if (mode === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A native construction accessor requires its exact admitted self ABI.", parent);
      if (mode.mode === "mut-ref") return true;
    }
  }
  return false;
}
