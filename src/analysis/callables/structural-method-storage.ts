import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceEnclosingCallable, asSourceNode } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustErrorRegionRecords } from "../../target-model/records/error-regions.js";
import { rustLifetimeKey, rustLifetimeOutlives, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "../../target-model/types/carriers/optional.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../target-model/types/carriers/source-types.js";
import { rustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustStructuralGenericCarrier } from "../../policy/types/objects/structural-generics.js";
import { rustEnclosingStorageContract } from "../../policy/ownership/suspended-storage.js";
import type { RustStructuralMethodConstruction, RustStructuralMethodStorageSelection, RustStructuralShapeDefinition } from "../../target-model/records/structural-shapes.js";
import type { RustStructuralShapePlanRegistry } from "../objects/structural-shape-plan.js";
import { rustNativeCallablePhysicalSource } from "../../policy/conversions/native-callables.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableProducerConstruction } from "./native-producers.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import { rustRetainedValueLifetime } from "../../policy/ownership/retained-environments.js";
import type { RustRetainedEnvironmentQueries } from "../../target-model/records/retained-environments.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/source-package-semantics.js";
import { normalizeRustErrorType, type RustErrorTypeContext } from "../errors/error-types.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustHasOpenOwnedStorage } from "../../policy/ownership/retained-environments.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import { rustFinalContractSupportsStatic } from "../declarations/generic-carrier-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import type { RustSourceObjectField, RustSourceTypeRegistry } from "../../policy/types/model/source-type-registry.js";
import type { RustNativeCaptureConstruction } from "./native-captures.js";
import type { RustNativeCaptureSelection } from "../../target-model/records/native-captures.js";
import { completeRustNativeCaptureCarrier } from "./native-captures.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import { rustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";

interface RustStructuralMethodDestination {
  readonly carrier: TargetTypeRef;
  readonly definition: RustStructuralShapeDefinition;
  readonly index: number;
}

interface RustStructuralMethodRoot extends RustStructuralMethodDestination {
  readonly subject: SourceStorageSubject;
  readonly bindings: SourceStorageBindings;
  readonly construction?: Pick<RustStructuralMethodConstruction, "object" | "property" | "expression" | "storageIndex">;
  readonly spread?: Extract<Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>["contributions"][number],
    { readonly kind: "spread" }>;
  readonly sourceField?: RustSourceObjectField;
}

export function createRustStructuralMethodStorage(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly sourceTypes: Pick<RustSourceTypeRegistry, "structuralObjectForType">;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly lifetimes: RustLifetimeIndex;
  readonly retainedEnvironments: RustRetainedEnvironmentQueries;
  readonly nativeCaptures: Pick<RustNativeCaptureConstruction, "require">;
  readonly genericCallables: RustGenericCallablePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
}): {
  prepareConstructors(components: RustSourcePackageComponentClassifications,
    effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
    producers: Pick<RustNativeCallableProducerConstruction, "selectConstructionErrors">): readonly RustSourceCallableSpecializationIssue[];
  complete(errors: Pick<RustErrorRegionRecords, "producerError">): readonly RustSourceCallableSpecializationIssue[];
  validateErrors(errors: Pick<RustErrorRegionRecords, "producerError">): void;
  validateRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
    families: Pick<RustSourceTypeFamilyRegistry, "implementation">, frames: RustFrameCallablePlan,
    classValues: RustClassValuePlan, errorTypes: RustErrorTypeContext): readonly RustSourceCallableSpecializationIssue[];
} {
  const { ast, records, sourceStorage, structuralShapes } = input;
  const canonical = new Map(structuralShapes.definitions.map(definition =>
    [`${definition.componentId}\0${definition.targetName}`, definition]));
  const roots: RustStructuralMethodRoot[] = [];
  const sourceIssues: RustSourceCallableSpecializationIssue[] = [];
  const admittedProducers = new Map<RustStructuralMethodRoot, readonly SourceStorageProducer[]>();
  const reject = (subject: Node, message: string): readonly RustSourceCallableSpecializationIssue[] =>
    Object.freeze([{ subject, message }]);
  const seen = new Map<SourceStorageSubject, Map<TargetTypeRef, Set<number>>>();
  const destinationFor = (carrier: TargetTypeRef, index: number): RustStructuralMethodDestination | undefined => {
    const selected = structuralShapes.definitionForCarrier(carrier);
    const field = selected?.fields[index];
    const method = field?.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field?.methodStorageCarrier;
    if (selected === undefined || field?.nativeMethod === true || rustCallableProtocol(method) === undefined) return;
    const definition = canonical.get(`${selected.componentId}\0${selected.targetName}`);
    if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage requires its canonical shape owner.");
    return Object.freeze({ carrier, definition, index });
  };
  const register = (node: Node, destination: RustStructuralMethodDestination, subject: SourceStorageSubject,
    origin?: Pick<RustStructuralMethodRoot, "construction" | "spread" | "sourceField">): void => {
    const { carrier, index } = destination;
    const carriers = seen.get(subject) ?? new Map<TargetTypeRef, Set<number>>();
    const indexes = carriers.get(carrier) ?? new Set<number>();
    if (indexes.has(index)) return;
    seen.set(subject, carriers);
    carriers.set(carrier, indexes);
    indexes.add(index);
    const owner = sourceEnclosingCallable(node, ast);
    const bindings = owner === undefined ? sourceStorage.emptyBindings : input.native.bindingsFor(owner);
    if (bindings === undefined) {
      sourceIssues.push({ subject: node, message: "Structural method storage requires its checked lexical activation." });
      return;
    }
    roots.push(Object.freeze({ ...destination, subject, bindings, ...origin }));
  };
  for (const node of input.nativeNodes) {
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "record-literal" && operation.storage === "structural-object") {
      const destinations = new Map<number, RustStructuralMethodDestination>();
      for (const field of operation.fields) {
        if (field.method !== true) continue;
        const destination = destinationFor(operation.resultCarrier, field.storageIndex);
        if (destination !== undefined) destinations.set(field.storageIndex, destination);
      }
      for (const contribution of operation.contributions) {
        if (contribution.kind === "structural-method") {
          const destination = destinations.get(contribution.targetStorageIndex);
          if (destination === undefined) continue;
          const selected = sourceStorage.subject(node, "value", [{ kind: "method-value", declaration: contribution.expression }]);
          if (selected.kind === "unresolved") sourceIssues.push({ subject: contribution.expression, message: selected.reason });
          else register(node, destination, selected.subject, { construction: Object.freeze({ object: node,
            property: contribution.property, expression: contribution.expression, storageIndex: contribution.targetStorageIndex }) });
        } else if (contribution.kind === "spread") {
          const transported = contribution.fields.filter(selected => selected.method === true && destinations.has(selected.targetStorageIndex));
          if (transported.length === 0) continue;
          const source = sourceStorage.subjectFor(contribution.expression);
          if (source.kind === "unresolved") {
            sourceIssues.push({ subject: contribution.expression, message: source.reason });
            continue;
          }
          const typed = sourceStorage.typeFor(source.subject);
          if (typed.kind === "unresolved") {
            sourceIssues.push({ subject: contribution.expression, message: typed.reason });
            continue;
          }
          const type = sourceStorage.source.semantics.forFile(typed.sourceFile).types.nonNullableType(typed.type);
          const shape = type === undefined ? undefined : input.sourceTypes.structuralObjectForType(type, contribution.sourceValueCarrier);
          for (const field of transported) {
            const destination = destinations.get(field.targetStorageIndex)!;
            const original = shape?.fields[field.sourceStorageIndex];
            if (original?.method !== true || original.declarations.length === 0 ||
              original.storageIndex !== field.sourceStorageIndex || !rustTargetTypeRefEquals(original.resultCarrier, field.carrier)) {
              sourceIssues.push({ subject: contribution.expression, message: "Structural method spread storage requires its exact checked source field layout." });
              continue;
            }
            for (const declaration of original.declarations) {
              const selected = sourceStorage.subject(source.subject.node, source.subject.kind,
                [...source.subject.projection, { kind: "method-value", declaration }]);
              if (selected.kind === "unresolved") sourceIssues.push({ subject: declaration, message: selected.reason });
              else register(node, destination, selected.subject, { spread: contribution, sourceField: original });
            }
          }
        }
      }
    } else if (operation?.kind === "source-call" && operation.target.form === "structural-method") {
      const destination = destinationFor(operation.target.receiverCarrier, operation.target.storageIndex);
      if (destination === undefined) continue;
      const callee = Node_Expression(ast, node);
      const subject = callee === undefined ? undefined : sourceStorage.subjectFor(callee);
      if (subject?.kind === "resolved") register(node, destination, subject.subject);
    } else if (operation?.kind === "source-field" && operation.storage === "structural-object" &&
      operation.valueSemantics.kind === "method") {
      const destination = destinationFor(operation.receiverCarrier, operation.storageIndex);
      if (destination === undefined) continue;
      const subject = sourceStorage.subjectFor(node);
      if (subject.kind === "resolved") register(node, destination, subject.subject);
    }
  }
  let complete = false;
  const producerErrors = new Map<import("../../target-model/types/carriers/producer-errors.js").RustProducerErrorReference, TargetTypeRef>();
  const retainedRequirements: { readonly declaration: Node; readonly bindings: RustTargetGenericBindings | undefined;
    physicalCaptures: RustNativeCaptureSelection | undefined }[] = [];
  let retentionValidated = false;
  return Object.freeze({
    prepareConstructors(components: RustSourcePackageComponentClassifications,
      effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
      producers: Pick<RustNativeCallableProducerConstruction, "selectConstructionErrors">) {
      if (sourceIssues.length !== 0) return Object.freeze(sourceIssues);
      const parent = new Map<Node, Node>();
      const errorByProducer = new Map<Node, TargetTypeRef>();
      const demands = new Map<Node, TargetTypeRef[]>();
      const slots = new Map<RustStructuralShapeDefinition, Map<number, Node>>();
      const rootFor = (declaration: Node): Node => {
        const previous = parent.get(declaration);
        if (previous === undefined) { parent.set(declaration, declaration); return declaration; }
        if (previous === declaration) return declaration;
        const root = rootFor(previous);
        parent.set(declaration, root);
        return root;
      };
      const context = { ast, components, records: { ...records, errorEffects: { get: (subject: import("@tsonic/tsts").ExtensionFactSubject | undefined) => {
        const node = asSourceNode(subject, ast);
        return node === undefined ? undefined : effectsFor(node);
      } } },
        producers: input.nativeProducers, definitions: input.typeDefinitions };
      for (const root of roots) {
        const selected = sourceStorage.storageProducersFor(root.subject, root.bindings);
        if (selected.kind !== "complete") return reject(root.subject.node, selected.kind === "unresolved" ? selected.reason
          : "Retained constructor selection requires its exact admitted source producer domain.");
        admittedProducers.set(root, selected.producers);
        const fields = slots.get(root.definition) ?? new Map<number, Node>();
        slots.set(root.definition, fields);
        const field = structuralShapes.field(root.carrier, root.index)!;
        const protocol = rustCallableProtocol(field.presence === "optional"
          ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier)!;
        for (const producer of selected.producers) {
          const subject = producer.subject;
          if (subject.kind !== "value" || subject.projection.length !== 0 ||
            records.targetOperation.get(subject.node)?.kind !== "closure")
            return reject(subject.node, "Retained constructor selection requires its admitted physical closure producer.");
          const declaration = subject.node;
          rootFor(declaration);
          const error = input.nativeProducers.errorFor(declaration, "invoke");
          const intrinsic = error === undefined ? undefined : normalizeRustErrorType(error, context, declaration);
          const declared = protocol.error === undefined ? undefined : normalizeRustErrorType(protocol.error, context, declaration);
          if (intrinsic === undefined || declared === undefined)
            return reject(declaration, "Retained constructor selection requires completed intrinsic error classification.");
          const reference = error === undefined ? undefined : rustProducerErrorReference(error);
          if (reference !== undefined) producerErrors.set(reference, intrinsic);
          errorByProducer.set(declaration, intrinsic);
          const requirements = demands.get(declaration) ?? [];
          if (!requirements.some(requirement => rustTargetTypeRefEquals(requirement, declared))) requirements.push(declared);
          demands.set(declaration, requirements);
          const existing = fields.get(root.index);
          if (existing === undefined) fields.set(root.index, declaration);
          else parent.set(rootFor(declaration), rootFor(existing));
        }
      }
      const groups = new Map<Node, Node[]>();
      for (const declaration of parent.keys()) {
        const root = rootFor(declaration);
        const members = groups.get(root) ?? [];
        members.push(declaration);
        groups.set(root, members);
      }
      const errors = new Map<Node, TargetTypeRef>();
      const infallible = (carrier: TargetTypeRef): boolean => carrier.kind === "target-named" && carrier.id === rustInfallibleTargetId;
      for (const members of groups.values()) {
        const intrinsic = members.map(member => errorByProducer.get(member)!);
        let selected = intrinsic[0]!;
        if (!intrinsic.every(error => rustTargetTypeRefEquals(error, selected))) {
          const candidates = members.flatMap(member => demands.get(member) ?? []);
          const shared = candidates.find(candidate => intrinsic.every(error => infallible(error) || rustTargetTypeRefEquals(error, candidate)));
          if (shared === undefined) return reject(members[0]!, "Connected retained method slots require one admitted native construction error ABI.");
          selected = shared;
        }
        for (const member of members) errors.set(member, selected);
      }
      producers.selectConstructionErrors(errors);
      return Object.freeze([]);
    },
    complete(errors) {
      if (complete) failTargetAnalysisInvariant("tsonic-rust", "Structural method physical storage completes exactly once.");
      const normalize = (carrier: TargetTypeRef): TargetTypeRef => mapRustTargetTypes(carrier, current => {
        const reference = rustProducerErrorReference(current);
        if (reference === undefined) return current;
        const selected = errors.producerError(reference);
        if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage lost its completed producer error channel.");
        producerErrors.set(reference, selected);
        return selected;
      });
      const candidates = new Map<RustStructuralMethodRoot, readonly TargetTypeRef[]>();
      const constructionCarriers = new Map<RustStructuralMethodRoot,
        readonly { readonly carrier: TargetTypeRef; readonly templateCarrier: TargetTypeRef; readonly bindings: RustTargetGenericBindings }[]>();
      for (const root of roots) {
        const selected = admittedProducers.get(root);
        if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage requires its constructor-admitted producer domain.");
        const field = structuralShapes.field(root.carrier, root.index)!;
        const storage = field.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier;
        const protocol = rustCallableProtocol(storage)!;
        const signatures: TargetTypeRef[] = [];
        const constructed: { readonly carrier: TargetTypeRef; readonly templateCarrier: TargetTypeRef;
          readonly bindings: RustTargetGenericBindings }[] = [];
        for (const producer of selected) {
          const subject = producer.subject;
          const operation = records.targetOperation.get(subject.node);
          if (subject.kind !== "value" || subject.projection.length !== 0 || operation?.kind !== "closure")
            failTargetAnalysisInvariant("tsonic-rust", "Structural method storage requires its exact admitted closure producer.");
          const logical = records.receiverIndependentMethod.get(subject.node)?.carrier ?? operation.resultCarrier;
          const physical = input.nativeProducers.physicalFor(subject.node, logical);
          const source = physical === undefined ? undefined : rustNativeCallablePhysicalSource(logical,
            { kind: "identity", carrier: physical });
          const owner = sourceEnclosingCallable(ast.parent(subject.node), ast);
          const bound = input.nativeStorage.genericBindingsFor(owner ?? subject.node, producer.bindings);
          if (bound.kind === "unresolved") return reject(subject.node, bound.reason);
          if (source === undefined || protocol.lifetime === undefined)
            return reject(subject.node, "Structural method storage requires its existing physical callable signature and destination lifetime.");
          const templateCarrier = normalize(source.carrier);
          const physicalCarrier = normalize(substituteRustTargetGenerics(templateCarrier,
            bound.bindings.types, bound.bindings.lifetimes, bound.bindings.consts));
          const physicalSignature = rustCallablePhysicalSignature(physicalCarrier);
          if (physicalSignature === undefined)
            failTargetAnalysisInvariant("tsonic-rust", "Structural method storage lost its exact normalized physical source signature.");
          const destinationLifetime = bound.bindings.lifetimes.get(rustLifetimeKey(protocol.lifetime)) ?? protocol.lifetime;
          const captures = records.closureCapture.get(subject.node);
          if (captures === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage requires its admitted closure capture inventory.");
          const sourceCaptureCarriers = [...captures.captures, ...captures.receiverFields, ...captures.receivers]
            .map(capture => capture.carrier);
          const captureCarriers = sourceCaptureCarriers.map(carrier => substituteRustTargetGenerics(carrier,
            bound.bindings.types, bound.bindings.lifetimes, bound.bindings.consts));
          const sourceRetained = rustRetainedValueLifetime(subject.node, sourceCaptureCarriers, { context: {
            ast, records, sourceLifetimes: input.lifetimes, retainedEnvironments: input.retainedEnvironments,
          } });
          const retained = sourceRetained === undefined ? undefined
            : bound.bindings.lifetimes.get(rustLifetimeKey(sourceRetained)) ?? sourceRetained;
          if (retained === undefined || destinationLifetime.kind !== "placeholder" && !rustLifetimeOutlives(retained,
            destinationLifetime, rustEnclosingStorageContract(subject.node, ast, input.lifetimes))) {
            if (destinationLifetime.kind !== "static" || !captureCarriers.some(rustHasOpenOwnedStorage))
              return reject(subject.node, "Structural method storage requires the actual captured lifetime to outlive its selected destination.");
            retainedRequirements.push({ declaration: subject.node, bindings: bound.bindings, physicalCaptures: undefined });
          }
          const carrier = rustCallableTargetType(physicalSignature.parameters, physicalSignature.result,
            destinationLifetime, physicalSignature.error);
          const signature = rustCallableProtocol(carrier)!;
          if (signature.parameters.length !== protocol.parameters.length)
            return reject(subject.node, "Structural method storage lost its admitted receiver correspondence.");
          const parameters = [...signature.parameters];
          if (field.receiverIndependent !== true) {
            if (!rustTargetTypeRefEquals(parameters[0], root.carrier))
              return reject(subject.node, "Structural method storage requires its exact selected receiver carrier.");
            parameters[0] = root.carrier;
          }
          const stored = rustCallableTargetType(parameters, signature.result, destinationLifetime, signature.error);
          signatures.push(field.presence === "optional" ? rustOptionTargetType(stored) : stored);
          if (root.construction !== undefined) {
            if (subject.node !== root.construction.expression)
              failTargetAnalysisInvariant("tsonic-rust", "Structural method construction lost its exact source contribution.");
          }
          if (physicalSignature.parameters.length !== signature.parameters.length ||
            !physicalSignature.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, parameters[index])) ||
            !rustTargetTypeRefEquals(physicalSignature.result, signature.result) ||
            !rustTargetTypeRefEquals(physicalSignature.error, signature.error))
            return reject(subject.node, "Structural method construction requires its exact normalized physical destination correspondence.");
          constructed.push(Object.freeze({ carrier: physicalCarrier, templateCarrier, bindings: bound.bindings }));
        }
        if (signatures.length === 0) return reject(root.subject.node, "Structural method storage cannot invent an ABI for an empty producer set.");
        candidates.set(root, Object.freeze(signatures));
        constructionCarriers.set(root, Object.freeze(constructed));
      }
      const originals: ReadonlyMap<Node, readonly RustStructuralMethodConstruction[]> = (() => {
        const constructions = new Map<Node, RustStructuralMethodConstruction[]>();
        for (const root of roots) {
          const original = root.construction;
          if (original === undefined) continue;
          const witnesses = constructions.get(original.expression) ?? [];
          for (const physical of constructionCarriers.get(root)!) {
            const field = structuralShapes.field(root.carrier, root.index)!;
            const protocol = rustCallableProtocol(field.presence === "optional"
              ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier)!;
            const signature = rustCallablePhysicalSignature(physical.templateCarrier)!;
            const destinationCarrier = rustCallableTargetType(signature.parameters, signature.result, protocol.lifetime, signature.error);
            witnesses.push(Object.freeze({ ...original, physicalCarrier: physical.templateCarrier, destinationCarrier }));
          }
          constructions.set(original.expression, witnesses);
        }
        for (const witnesses of constructions.values()) Object.freeze(witnesses);
        return constructions;
      })();
      const selections = new Map<RustStructuralShapeDefinition, Map<number, RustStructuralMethodStorageSelection>>();
      for (const root of roots) {
        if (root.spread !== undefined) {
          const sourceField = root.sourceField;
          const projected = root.subject.projection[root.subject.projection.length - 1];
          const transported = root.spread.fields.filter(field => field.method === true && field.targetStorageIndex === root.index);
          if (sourceField === undefined || transported.length !== 1 ||
            transported[0]!.sourceStorageIndex !== sourceField.storageIndex ||
            !rustTargetTypeRefEquals(transported[0]!.carrier, sourceField.resultCarrier) ||
            projected?.kind !== "method-value" || !sourceField.declarations.includes(projected.declaration) ||
            structuralShapes.field(root.spread.sourceValueCarrier, sourceField.storageIndex)?.method !== true)
            failTargetAnalysisInvariant("tsonic-rust", "Structural method spread lost its exact source field and destination contribution.");
        }
        const source = rustStructuralGenericCarrier(root.carrier).carrier;
        const refs = rustTargetGenericReferences(source);
        const shape = rustStructuralObjectCarrierValue(source)!;
        const aligned = rustStructuralObjectTargetType(root.definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
        const bindings = inferRustTargetGenericBindings(aligned, root.definition.carrier, {
          typeIdentities: new Set(refs.typeIdentities), lifetimeIdentities: new Set(refs.lifetimeIdentities), constIdentities: new Set(refs.constIdentities),
        });
        const exactBindings = bindings !== undefined && rustTargetTypeRefEquals(substituteRustTargetGenerics(aligned,
          bindings.types, bindings.lifetimes, bindings.consts), root.definition.carrier) ? bindings : undefined;
        const fields = selections.get(root.definition) ?? new Map<number, RustStructuralMethodStorageSelection>();
        selections.set(root.definition, fields);
        for (const [ordinal, candidate] of candidates.get(root)!.entries()) {
          const mapped = exactBindings === undefined ? candidate : substituteRustTargetGenerics(candidate,
            exactBindings.types, exactBindings.lifetimes, exactBindings.consts);
          const templateField = root.definition.fields[root.index]!;
          const templateProtocol = rustCallableProtocol(templateField.presence === "optional"
            ? rustOptionElementCarrier(templateField.methodStorageCarrier) : templateField.methodStorageCarrier)!;
          const mappedProtocol = rustCallableProtocol(root.definition.fields[root.index]!.presence === "optional"
            ? rustOptionElementCarrier(mapped) : mapped)!;
          const actualProtocol = rustCallableProtocol(root.definition.fields[root.index]!.presence === "optional"
            ? rustOptionElementCarrier(candidate) : candidate)!;
          const sourceField = structuralShapes.field(root.carrier, root.index)!;
          const sourceProtocol = rustCallableProtocol(sourceField.presence === "optional"
            ? rustOptionElementCarrier(sourceField.methodStorageCarrier) : sourceField.methodStorageCarrier)!;
          if (templateProtocol.lifetime === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method template requires its admitted destination lifetime.");
          const parameters = mappedProtocol.parameters.map((parameter, index) =>
            rustTargetTypeRefEquals(actualProtocol.parameters[index], sourceProtocol.parameters[index])
              ? templateProtocol.parameters[index]! : parameter);
          const result = rustTargetTypeRefEquals(actualProtocol.result, sourceProtocol.result)
            ? templateProtocol.result : mappedProtocol.result;
          const carrier = rustCallableTargetType(parameters, result,
            templateProtocol.lifetime, mappedProtocol.error);
          const selected = templateField.presence === "optional" ? rustOptionTargetType(carrier) : carrier;
          const existing = fields.get(root.index);
          if (existing !== undefined && !rustTargetTypeRefEquals(existing.carrier, selected))
            return reject(root.subject.node, "Structural method storage has incompatible admitted physical signatures.");
          const constructions = [...existing?.constructions ?? []];
          const actual = constructionCarriers.get(root)?.[ordinal];
          const producer = admittedProducers.get(root)?.[ordinal];
          if (actual === undefined || producer === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage lost its actual construction carrier.");
          const originalSources = originals.get(producer.subject.node);
          if (originalSources === undefined || originalSources.length === 0)
            return reject(root.subject.node, "Structural method storage lost its original admitted source construction witness.");
          for (const original of originalSources) {
            const physical = normalize(substituteRustTargetGenerics(original.physicalCarrier,
              actual.bindings.types, actual.bindings.lifetimes, actual.bindings.consts));
            const originalDestination = rustCallableProtocol(normalize(substituteRustTargetGenerics(original.destinationCarrier,
              actual.bindings.types, actual.bindings.lifetimes, actual.bindings.consts)));
            const originalSignature = rustCallablePhysicalSignature(physical);
            if (!rustTargetTypeRefEquals(physical, actual.carrier) || originalSignature === undefined || originalDestination === undefined ||
              originalSignature.parameters.length !== originalDestination.parameters.length ||
              !originalSignature.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, originalDestination.parameters[index])) ||
              !rustTargetTypeRefEquals(originalSignature.result, originalDestination.result) ||
              !rustTargetTypeRefEquals(originalSignature.error, originalDestination.error))
              return reject(root.subject.node, "Structural method transport requires its complete actual bound source construction witness.");
            const references = rustTargetGenericReferences(original.destinationCarrier);
            const witnessBindings = inferRustTargetGenericBindings(original.destinationCarrier, carrier, {
              typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
              constIdentities: new Set(references.constIdentities),
            });
            if (witnessBindings === undefined || !rustTargetTypeRefEquals(substituteRustTargetGenerics(original.destinationCarrier,
              witnessBindings.types, witnessBindings.lifetimes, witnessBindings.consts), carrier))
              return reject(root.subject.node, "Structural method construction lost its exact source-to-destination template binding.");
            const physicalCarrier = normalize(substituteRustTargetGenerics(original.physicalCarrier,
              witnessBindings.types, witnessBindings.lifetimes, witnessBindings.consts));
            const physicalSignature = rustCallablePhysicalSignature(physicalCarrier);
            const destination = rustCallableProtocol(carrier)!;
            if (physicalSignature === undefined || physicalSignature.parameters.length !== destination.parameters.length ||
              !physicalSignature.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, destination.parameters[index])) ||
              !rustTargetTypeRefEquals(physicalSignature.result, destination.result) ||
              !rustTargetTypeRefEquals(physicalSignature.error, destination.error))
              return reject(root.subject.node, "Structural method construction lost its complete template destination correspondence.");
            const construction = Object.freeze({ ...original, storageIndex: root.index, physicalCarrier, destinationCarrier: carrier });
            const previous = constructions.find(value => value.object === construction.object &&
              value.property === construction.property && value.expression === construction.expression &&
              value.storageIndex === construction.storageIndex);
            if (previous === undefined) constructions.push(construction);
            else if (!rustTargetTypeRefEquals(previous.physicalCarrier, physicalCarrier) ||
              !rustTargetTypeRefEquals(previous.destinationCarrier, carrier))
              return reject(root.subject.node, "Structural method contribution has contradictory physical construction bindings.");
          }
          fields.set(root.index, Object.freeze({ carrier: selected, constructions: Object.freeze(constructions) }));
        }
      }
      for (const root of roots) {
        const template = selections.get(root.definition)?.get(root.index)?.carrier;
        if (template === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural method storage requires its own canonical template contribution.");
        const refs = root.definition.genericParameters;
        const shape = rustStructuralObjectCarrierValue(root.carrier)!;
        const aligned = rustStructuralObjectTargetType(root.definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
        const bindings = inferRustTargetGenericBindings(root.definition.carrier, aligned, {
          typeIdentities: new Set(refs.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : [])),
          lifetimeIdentities: new Set(rustTargetGenericReferences(root.definition.carrier).lifetimeIdentities), constIdentities: new Set(),
        });
        if (bindings === undefined) return reject(root.subject.node, "Structural method storage lost its forward template application.");
        const expected = substituteRustTargetGenerics(template, bindings.types, bindings.lifetimes, bindings.consts,
          (carrier, original) => rustTargetTypeRefEquals(original, root.definition.carrier) ? root.carrier : carrier);
        for (const candidate of candidates.get(root)!) {
          if (!rustTargetTypeRefEquals(expected, candidate))
            return reject(root.subject.node, "Structural method storage does not match its exact forward-applied physical template.");
        }
      }
      structuralShapes.finalizeMethodStorage(selections);
      for (const expression of new Set([...selections.values()].flatMap(fields =>
        [...fields.values()].flatMap(field => field.constructions.map(construction => construction.expression)))))
        input.nativeCaptures.require(expression);
      for (const requirement of retainedRequirements)
        requirement.physicalCaptures = input.nativeCaptures.require(requirement.declaration);
      complete = true;
      return Object.freeze([]);
    },
    validateErrors(errors: Pick<RustErrorRegionRecords, "producerError">) {
      if (!complete) failTargetAnalysisInvariant("tsonic-rust", "Structural method error validation requires its complete physical field plan.");
      for (const [reference, carrier] of producerErrors) {
        if (!rustTargetTypeRefEquals(errors.producerError(reference), carrier))
          failTargetAnalysisInvariant("tsonic-rust", "Structural method storage changed its selected intrinsic error layout after physical materialization.");
      }
    },
    validateRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
      families: Pick<RustSourceTypeFamilyRegistry, "implementation">, frames: RustFrameCallablePlan,
      classValues: RustClassValuePlan, errorTypes: RustErrorTypeContext) {
      if (!complete || retentionValidated) failTargetAnalysisInvariant("tsonic-rust", "Structural retention validates once against the completed declaration requirements.");
      const issues: RustSourceCallableSpecializationIssue[] = [];
      for (const requirement of retainedRequirements) {
        const owner = sourceEnclosingCallable(ast.parent(requirement.declaration), ast);
        const contract = owner === undefined ? undefined : requirements.contractFor(owner, true);
        const physical = requirement.physicalCaptures;
        if (contract === undefined || physical === undefined || physical.kind === "unresolved" || requirement.bindings === undefined) {
          issues.push({ subject: requirement.declaration, message: physical?.kind === "unresolved" ? physical.reason
            : "Structural method retention requires its completed physical captures and actual final native generic contract." });
          continue;
        }
        const normalized = completeRustNativeCaptureCarrier(requirement.declaration, physical, requirement.bindings, errorTypes);
        if (normalized.kind === "unresolved") {
          issues.push({ subject: requirement.declaration,
            message: "Structural method retention requires its actual admitted physical error-boundary carriers." });
          continue;
        }
        const selected = rustFinalContractSupportsStatic(contract, normalized.carrier, families, input.typeDefinitions,
          { lifetimeContract: input.lifetimes.contractFor(owner), genericCallables: input.genericCallables,
            frameCallables: frames, classValues, objectRepresentations: input.objectRepresentations,
            structuralShapes, projectTypes: input.projectTypes, records });
        if (selected.kind !== "supported") issues.push({ subject: requirement.declaration, message: selected.reason });
      }
      retentionValidated = issues.length === 0;
      return Object.freeze(issues);
    },
  });
}
