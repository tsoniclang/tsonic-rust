import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceParameterIsProperty } from "@tsonic/target-api/source";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustOptionCarrier, isRustAbsenceCarrier } from "../../target-model/types/index.js";
import { type RustProjectTypeDefinition, type RustProjectTypePolicy } from "./index.js";
import { rustInheritedProjectConstructor } from "./inherited-constructors.js";
import type { RustObjectRepresentationPlan } from "./object-representation.js";
import type { RustFrameCallablePlan } from "../../target-model/records/callables/frame-callables.js";
import type { RustFrameCallableDefinition } from "../../target-model/records/callables/frame-callables.js";
import { validatedRustCapturedFieldStorageFact } from "../storage/receiver-captures.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { analyzeRustConstructionReadiness, type RustConstructionPointQueries } from "./construction-readiness.js";

import { selectRustExternalInitialization } from "./external-initialization.js";
import type { RustExternalInitialization } from "../../target-model/records/objects/construction.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import type { RustConstructionField, RustConstructionLayer, RustConstructionProjection, RustConstructionPreparationSelection } from "../../target-model/records/objects/construction.js";

export interface RustConstructionIssue {
  readonly node: Node;
  readonly reason: string;
}

export interface RustConstructionEmissionPlan {
  readonly frame: RustFrameCallableDefinition | undefined;
  readonly exposure: { readonly declaration: Node; readonly expression: Node; readonly carrier: TargetTypeRef } | undefined;
  readonly issues: readonly RustConstructionIssue[];
  preparationFor(node: Node): RustConstructionPreparationSelection | undefined;
}

export interface RustProjectConstructionPlan extends RustConstructionPointQueries {
  readonly definition: RustProjectTypeDefinition;
  readonly layers: readonly RustConstructionLayer[];
  readonly fields: readonly RustConstructionField[];
  readonly issues: readonly RustConstructionIssue[];
  readonly publishesReceiver: boolean;
  readonly emission: RustConstructionEmissionPlan;
}

export interface RustProjectConstructionQueries {
  forDefinition(definition: RustProjectTypeDefinition): RustProjectConstructionPlan | undefined;
  externalInitializationForCall(call: Node): RustExternalInitialization | undefined;
  ownsExternalArgument(argument: Node): boolean;
}

export interface RustConstructionAnalysisInput {
  readonly ast: AstReader;
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly frames: RustFrameCallablePlan;
  mayThrow(node: Node): boolean;
}

export function analyzeRustProjectConstructions(input: RustConstructionAnalysisInput): RustProjectConstructionQueries {
  const plans = new Map<RustProjectTypeDefinition, RustProjectConstructionPlan>();
  const externalInitializations = new WeakMap<Node, RustExternalInitialization>();
  const ownedExternalArguments = new WeakSet<Node>();
  for (const definition of input.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    const lineage = input.projectTypes.classLineage(definition);
    const layers: RustConstructionLayer[] = [];
    const issues: RustConstructionIssue[] = [];
    if (lineage === undefined) {
      issues.push(Object.freeze({ node: definition.declaration,
        reason: "Native construction requires one exact source class lineage." }));
    } else {
      let selected = input.projectTypes.constructorsForDefinition(definition)[0];
      if (selected === undefined) issues.push(Object.freeze({ node: definition.declaration,
        reason: "Native construction has no exact effective constructor signature." }));
      for (let index = lineage.length - 1; index >= 0 && selected !== undefined; index -= 1) {
        const owner = lineage[index]!;
        const constructor = input.ast.members(owner.declaration).find(member => member !== undefined &&
          input.ast.kindName(member) === "KindConstructor" && input.ast.body(member) !== undefined);
        const body = constructor === undefined ? undefined : input.ast.body(constructor);
        const rawStatements = body === undefined ? [] : input.ast.statements(body);
        if (rawStatements.some(statement => statement === undefined)) {
          issues.push(Object.freeze({ node: owner.declaration, reason: "Constructor contains an undefined statement slot." }));
          break;
        }
        const base = input.projectTypes.heritageForDefinition(owner).find(edge => edge.kind === "extends" && edge.target.kind === "class");
        const external = input.projectTypes.externalBaseForDefinition(owner);
        const first = rawStatements[0];
        const call = first === undefined || input.ast.kindName(first) !== "KindExpressionStatement"
          ? undefined : Node_Expression(input.ast, first);
        const callee = call === undefined ? undefined : Node_Expression(input.ast, call);
        const baseCall = call !== undefined && input.ast.is.IsCallExpression(call) &&
          callee !== undefined && input.ast.kindName(callee) === "KindSuperKeyword" ? call : undefined;
        if (external !== undefined && baseCall !== undefined) {
          const initialization = selectRustExternalInitialization(external, baseCall, input.ast, input.records, input.typeDefinitions);
          if (initialization === undefined) issues.push(Object.freeze({ node: baseCall,
            reason: "External field initialization has no exact selected native input contract." }));
          else {
            externalInitializations.set(baseCall, initialization);
            const argument = input.ast.arguments(baseCall)[0];
            if (argument !== undefined && (initialization.kind === "value" || initialization.kind === "optional"))
              ownedExternalArguments.add(argument);
          }
        }
        const fields: RustConstructionField[] = [];
        for (const field of external?.fields ?? []) fields.push(Object.freeze({
          declaration: field.declaration, owner, carrier: field.carrier,
          absenceDefault: false, externallyInitialized: true,
        }));
        for (const field of input.projectTypes.objectLayoutForDefinition(owner)?.fields ?? []) {
          if (input.ast.hasModifierKind(field.declaration, "abstract") ||
            input.objectRepresentations.aliasFor(field.declaration) !== undefined) continue;
          const carrier = input.records.runtimeCarrier.get(field.declaration)?.carrier;
          const initializer = sourceParameterIsProperty(input.ast, field.declaration)
            ? input.ast.name(field.declaration) : Node_Initializer(input.ast, field.declaration);
          if (carrier === undefined) {
            issues.push(Object.freeze({ node: field.declaration, reason: "Physical constructor field has no exact finalized carrier." }));
            continue;
          }
          fields.push(Object.freeze({ declaration: field.declaration, owner, carrier, externallyInitialized: false,
            absenceDefault: initializer === undefined && (isRustOptionCarrier(carrier) || isRustAbsenceCarrier(carrier)),
            ...(initializer === undefined ? {} : { initializer }) }));
        }
        layers.unshift(Object.freeze({ definition: owner, signature: selected, constructor,
          ...(baseCall === undefined ? {} : { baseCall }),
          fields: Object.freeze(fields), statements: Object.freeze(rawStatements.slice(baseCall === undefined ? 0 : 1) as Node[]) }));
        if (constructor !== undefined && (base !== undefined || external !== undefined) && baseCall === undefined)
          issues.push(Object.freeze({ node: constructor,
            reason: "Native inheritance requires its exact checked super(...) constructor call as the first statement." }));
        if (base !== undefined) {
          const inherited = constructor === undefined ? rustInheritedProjectConstructor(input.projectTypes, owner, selected) : undefined;
          const fact = baseCall === undefined ? undefined : input.records.targetOperation.get(baseCall);
          selected = inherited?.base === base.target ? inherited.constructor
            : fact?.kind === "source-call" && fact.target.form === "constructor"
              ? input.projectTypes.constructorForTargetName(base.target, fact.target.name) : undefined;
          if (selected === undefined) issues.push(Object.freeze({ node: constructor ?? owner.declaration,
            reason: "Inherited construction has no exact selected base constructor contract." }));
        }
      }
    }
    const physicalDeclaration = input.objectRepresentations.receiverCaptures.storageDeclaration;
    const logicalFields = layers.flatMap(layer => layer.fields);
    const fields = Object.freeze(logicalFields.filter(field => physicalDeclaration(field.declaration) === field.declaration));
    const physicalFields = new Map(fields.map(field => [field.declaration, field]));
    const receiver = input.projectTypes.openCarrier(definition);
    for (const field of logicalFields) {
      const declaration = physicalDeclaration(field.declaration);
      if (declaration === field.declaration) continue;
      const physical = physicalFields.get(declaration);
      const actualCarrier = input.projectTypes.instantiateMemberCarrier(field.declaration, receiver, field.carrier);
      const physicalCarrier = physical === undefined ? undefined
        : input.projectTypes.instantiateMemberCarrier(physical.declaration, receiver, physical.carrier);
      if (physicalCarrier === undefined || !rustTargetTypeRefEquals(actualCarrier, physicalCarrier))
        issues.push(Object.freeze({ node: field.declaration,
          reason: "A retained override family requires one exact native physical payload carrier." }));
    }
    const readiness = analyzeRustConstructionReadiness({ ast: input.ast, definition,
      isNativeNode: input.isNativeNode,
      layers: layers.map(layer => ({ ...layer, fields: layer.fields.map(field => ({ ...field,
        declaration: physicalDeclaration(field.declaration) })) })), fields,
      selectedField(node) {
        const fact = input.records.targetOperation.get(node);
        return fact?.kind === "source-field" && fact.storage === "project-object" &&
          fact.valueSemantics.kind === "stored" && fact.declaration !== undefined
          ? { declaration: physicalDeclaration(fact.declaration), accessMode: fact.accessMode } : undefined;
      },
      guardResult: node => input.records.nativeGuardResult.get(node),
      unreachable: node => input.records.nativeUnreachable.get(node) === true,
      mayThrow: input.mayThrow,
    });
    // An absence default the constructor can never observe is not emitted: the field is initialized by its first write.
    const settle = (field: RustConstructionField): RustConstructionField => field.absenceDefault &&
      !readiness.observesInitialValue(physicalDeclaration(field.declaration)) ? Object.freeze({ ...field, absenceDefault: false }) : field;
    const settledLayers = layers.map(layer => Object.freeze({ ...layer, fields: Object.freeze(layer.fields.map(settle)) }));
    const settledFields = Object.freeze(fields.map(settle));
    const emission = prepareRustConstructionEmission(input, definition, settledLayers, settledFields, readiness);
    plans.set(definition, Object.freeze({ definition, layers: Object.freeze(settledLayers), fields: settledFields, emission,
      issues: Object.freeze([...issues, ...readiness.issues]), pointFor: readiness.pointFor,
      points: readiness.points, returnLayerFor: readiness.returnLayerFor,
      expressions: readiness.expressions,
      completesNormally: readiness.completesNormally, layerCompletes: readiness.layerCompletes,
      layerHasEarlyReturn: readiness.layerHasEarlyReturn,
      mutatesUnpublishedField: readiness.mutatesUnpublishedField,
      accessesUnpublishedField: readiness.accessesUnpublishedField,
      observesInitialValue: readiness.observesInitialValue,
      expressionsWithin: readiness.expressionsWithin, publishesReceiver: readiness.publishesReceiver }));
  }
  return Object.freeze({ forDefinition: (definition: RustProjectTypeDefinition) => plans.get(definition),
    externalInitializationForCall: (call: Node) => externalInitializations.get(call),
    ownsExternalArgument: (argument: Node) => ownedExternalArguments.has(argument) });
}

function prepareRustConstructionEmission(input: RustConstructionAnalysisInput, definition: RustProjectTypeDefinition,
  layers: readonly RustConstructionLayer[], fields: readonly RustConstructionField[], readiness: RustConstructionPointQueries): RustConstructionEmissionPlan {
  const frame = input.frames.definitionForOwner(definition.declaration);
  const exposure = frame?.storage.kind === "standalone" ? frame.constructionExposure : undefined;
  const issues: RustConstructionIssue[] = [];
  const issue = (node: Node, reason: string): void => {
    if (!issues.some(value => value.node === node && value.reason === reason)) issues.push(Object.freeze({ node, reason }));
  };
  const fieldsByDeclaration = new Map(fields.map(field => [field.declaration, field]));
  const capturedStorage = new Map(fields.map(field => [field.declaration,
    validatedRustCapturedFieldStorageFact(field.declaration, input)]));
  const frameCarrier = frame?.entries[0]?.implementations[0]?.carrier;
  const frameValue = rustFrameCallableValue(frameCarrier);
  const frameEntry = frameCarrier === undefined ? undefined : input.frames.entryFor(frameCarrier);
  let selectedExposure: RustConstructionEmissionPlan["exposure"];
  if (exposure !== undefined && frame !== undefined) {
    const point = readiness.pointFor(exposure.expression);
    const exactFrame = frameCarrier !== undefined && input.frames.definitionFor(frameCarrier) === frame &&
      frameEntry !== undefined && frame.entries.includes(frameEntry) && frameValue !== undefined &&
      frameValue.environment.length === frameEntry.environmentIndexes.length &&
      frame.environmentParameters.every((_parameter, index) => frameEntry.environmentIndexes.includes(index));
    if (!exactFrame || point === undefined || fieldsByDeclaration.get(exposure.declaration)?.initializer !== exposure.expression ||
      frame.bindings.some(binding => !fieldsByDeclaration.has(binding.declaration) ||
        binding.initialization !== "deferred" && !point.initializedFields.includes(binding.declaration))) {
      issue(exposure.expression, "A retained constructor callback requires initialized native frame storage.");
    } else selectedExposure = Object.freeze({ ...exposure, carrier: frameCarrier! });
  }
  const root = input.projectTypes.openCarrier(definition);
  const retainedNodes = new Set<Node>();
  if (selectedExposure !== undefined) {
    const pending = [selectedExposure.expression];
    while (pending.length !== 0) {
      const node = pending.pop()!;
      if (retainedNodes.has(node)) continue;
      retainedNodes.add(node);
      input.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
  }
  const preparations = new Map<Node, RustConstructionPreparationSelection>();
  for (const point of readiness.points) {
    const layer = layers.find(selected => selected.definition === point.layer);
    if (layer === undefined) {
      issue(point.node, "A construction point has no exact selected native source layer.");
      continue;
    }
    const retainsFrame = selectedExposure !== undefined &&
      (point.initializedFields.includes(selectedExposure.declaration) || retainedNodes.has(point.node));
    const projections: RustConstructionProjection[] = [];
    for (const expression of readiness.expressionsWithin(point.node)) {
      const fixedSelf = expression.kind === "capture" ? input.objectRepresentations.receiverCaptures.fixedSelfForReference(expression.node) : undefined;
      if (fixedSelf !== undefined) {
        if (expression.declaration !== fixedSelf.declaration) issue(expression.node, "A fixed field self lost its exact construction declaration.");
        else projections.push(Object.freeze({ kind: "fixed-self", expression }));
        continue;
      }
      if ((expression.kind === "field" || expression.kind === "capture") && !point.published && !point.publishBefore) {
        const declaration = expression.declaration;
        const field = declaration === undefined ? undefined : fieldsByDeclaration.get(declaration);
        if (field === undefined) {
          issue(expression.node, "Sealed construction field has no matching physical local slot.");
          continue;
        }
        const binding = input.frames.bindingFor(field.declaration);
        const captured = capturedStorage.get(field.declaration);
        if (expression.kind === "capture" && binding === undefined && captured === undefined) {
          issue(expression.node, "A captured native field lost its exact physical owner contract.");
          continue;
        }
        projections.push(Object.freeze({ kind: "local", expression, declaration: field.declaration,
          storage: binding !== undefined ? "frame" : captured !== undefined ? "captured" : "value" }));
      } else if (point.published || point.publishBefore) {
        const receiver = expression.kind === "receiver" ? expression.node : expression.receiver;
        if (receiver === undefined) {
          issue(expression.node, "Sealed construction projection has no exact receiver node.");
          continue;
        }
        const declaredCarrier = input.records.runtimeCarrier.get(receiver)?.carrier;
        const carrier = declaredCarrier === undefined ? undefined : input.projectTypes.instantiateMemberCarrier(receiver, root, declaredCarrier);
        const target = carrier === undefined ? undefined : input.projectTypes.definitionForCarrier(carrier);
        const relation = target === undefined ? undefined : input.projectTypes.relationship(root, target);
        if (carrier === undefined || target === undefined || relation?.kind !== "related" || !rustTargetTypeRefEquals(relation.targetType, carrier) ||
          !rustTargetTypeRefEquals(root, carrier) && (!input.projectTypes.isPolymorphic(definition) || !input.projectTypes.isPolymorphic(target))) {
          issue(receiver, carrier === undefined ? "Sealed construction receiver has no finalized native carrier."
            : "Finalized construction receiver differs from its same-root native view.");
          continue;
        }
        projections.push(Object.freeze({ kind: "receiver", expression, node: receiver, carrier,
          projection: rustTargetTypeRefEquals(root, carrier) ? "identity" : "polymorphic" }));
      }
    }
    preparations.set(point.node, Object.freeze({ point, layer, retainsFrame, projections: Object.freeze(projections) }));
  }
  return Object.freeze({ frame, exposure: selectedExposure, issues: Object.freeze(issues),
    preparationFor: (node: Node) => preparations.get(node) });
}
