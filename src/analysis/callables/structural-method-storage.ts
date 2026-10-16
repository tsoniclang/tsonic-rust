import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceEnclosingCallable, asSourceNode } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorRegionRecords } from "../../target-model/records/error-regions.js";
import { rustLifetimeOutlives, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
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
import { rustStructuralGenericCarrier } from "../objects/structural-generic-carrier.js";
import { rustEnclosingStorageContract } from "../../policy/ownership/suspended-storage.js";
import type { RustStructuralShapeDefinition, RustStructuralShapePlanRegistry } from "../objects/structural-shape-plan.js";
import { rustNativeCallablePhysicalSource } from "./native-conversions.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableProducerPlan, RustNativeCallableProducerConstruction } from "./native-producers.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import { rustRetainedValueLifetime } from "./retained-environments.js";
import type { RustRetainedEnvironmentQueries } from "../../policy/ownership/retained-environment-queries.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustSourcePackageComponentClassifications } from "../program/source-package-components.js";
import { normalizeRustErrorType } from "../program/error-types.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustHasOpenOwnedStorage } from "../../policy/ownership/retained-environments.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import { rustFinalContractSupportsStatic } from "../declarations/generic-carrier-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";

interface RustStructuralMethodRoot {
  readonly carrier: TargetTypeRef;
  readonly definition: RustStructuralShapeDefinition;
  readonly index: number;
  readonly subject: SourceStorageSubject;
  readonly bindings: SourceStorageBindings;
}

export function createRustStructuralMethodStorage(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly lifetimes: RustLifetimeIndex;
  readonly retainedEnvironments: RustRetainedEnvironmentQueries;
}): {
  prepareConstructors(components: RustSourcePackageComponentClassifications,
    effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
    producers: Pick<RustNativeCallableProducerConstruction, "selectConstructionErrors">): void;
  complete(errors: Pick<RustErrorRegionRecords, "producerError">): void;
  validateErrors(errors: Pick<RustErrorRegionRecords, "producerError">): void;
  validateRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
    families: Pick<RustSourceTypeFamilyRegistry, "implementation">): void;
} {
  const { ast, records, sourceStorage, structuralShapes } = input;
  const canonical = new Map(structuralShapes.definitions.map(definition =>
    [`${definition.componentId}\0${definition.targetName}`, definition]));
  const roots: RustStructuralMethodRoot[] = [];
  const seen = new Map<SourceStorageSubject, Map<TargetTypeRef, Set<number>>>();
  const register = (node: Node, carrier: TargetTypeRef, index: number, subject: SourceStorageSubject): void => {
    const selected = structuralShapes.definitionForCarrier(carrier);
    const field = selected?.fields[index];
    const method = field?.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field?.methodStorageCarrier;
    if (selected === undefined || field?.nativeMethod === true || rustCallableProtocol(method) === undefined) return;
    const definition = canonical.get(`${selected.componentId}\0${selected.targetName}`);
    if (definition === undefined) throw new Error("Structural method storage requires its canonical shape owner.");
    const carriers = seen.get(subject) ?? new Map<TargetTypeRef, Set<number>>();
    const indexes = carriers.get(carrier) ?? new Set<number>();
    if (indexes.has(index)) return;
    seen.set(subject, carriers);
    carriers.set(carrier, indexes);
    indexes.add(index);
    const owner = sourceEnclosingCallable(node, ast);
    const bindings = owner === undefined ? sourceStorage.emptyBindings : input.native.bindingsFor(owner);
    if (bindings === undefined) throw new Error("Structural method storage requires its checked lexical activation.");
    roots.push(Object.freeze({ carrier, definition, index, subject, bindings }));
  };
  for (const node of sourceStorage.nodes) {
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "record-literal" && operation.storage === "structural-object") {
      for (const field of operation.fields) {
        if (field.method !== true) continue;
        const contributions = operation.contributions.filter(contribution =>
          contribution.kind === "structural-method" && contribution.targetStorageIndex === field.storageIndex);
        const declarations = contributions.flatMap(contribution => contribution.kind === "structural-method"
          ? [contribution.expression] : []);
        if (declarations.length === 0 && operation.contributions.some(contribution => contribution.kind === "spread" &&
          contribution.fields.some(selected => selected.targetStorageIndex === field.storageIndex && selected.method === true)))
          declarations.push(...field.contractDeclarations);
        for (const declaration of declarations) {
          const selected = sourceStorage.subject(node, "value", [{ kind: "method-value", declaration }]);
          if (selected.kind === "unresolved") throw new Error(selected.reason);
          register(node, operation.resultCarrier, field.storageIndex, selected.subject);
        }
      }
    } else if (operation?.kind === "source-call" && operation.target.form === "structural-method") {
      const callee = Node_Expression(ast, node);
      const subject = callee === undefined ? undefined : sourceStorage.subjectFor(callee);
      if (subject?.kind === "resolved") register(node, operation.target.receiverCarrier, operation.target.storageIndex, subject.subject);
    } else if (operation?.kind === "source-field" && operation.storage === "structural-object" &&
      operation.valueSemantics.kind === "method") {
      const subject = sourceStorage.subjectFor(node);
      if (subject.kind === "resolved") register(node, operation.receiverCarrier, operation.storageIndex, subject.subject);
    }
  }
  let complete = false;
  const producerErrors = new Map<import("../../target-model/types/carriers/producer-errors.js").RustProducerErrorReference, TargetTypeRef>();
  const retainedRequirements: { readonly declaration: Node; readonly captures: readonly TargetTypeRef[] }[] = [];
  let retentionValidated = false;
  return Object.freeze({
    prepareConstructors(components: RustSourcePackageComponentClassifications,
      effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
      producers: Pick<RustNativeCallableProducerConstruction, "selectConstructionErrors">) {
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
        if (selected.kind !== "complete") throw new Error(selected.kind === "unresolved" ? selected.reason
          : "Retained constructor selection requires its exact admitted source producer domain.");
        const fields = slots.get(root.definition) ?? new Map<number, Node>();
        slots.set(root.definition, fields);
        const field = structuralShapes.field(root.carrier, root.index)!;
        const protocol = rustCallableProtocol(field.presence === "optional"
          ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier)!;
        for (const producer of selected.producers) {
          const subject = producer.subject;
          if (subject.kind !== "value" || subject.projection.length !== 0 ||
            records.targetOperation.get(subject.node)?.kind !== "closure")
            throw new Error("Retained constructor selection requires its admitted physical closure producer.");
          const declaration = subject.node;
          rootFor(declaration);
          const error = input.nativeProducers.errorFor(declaration, "invoke");
          const intrinsic = error === undefined ? undefined : normalizeRustErrorType(error, context, declaration);
          const declared = protocol.error === undefined ? undefined : normalizeRustErrorType(protocol.error, context, declaration);
          if (intrinsic === undefined || declared === undefined)
            throw new Error("Retained constructor selection requires completed intrinsic error classification.");
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
          if (shared === undefined) throw new Error("Connected retained method slots require one admitted native construction error ABI.");
          selected = shared;
        }
        for (const member of members) errors.set(member, selected);
      }
      producers.selectConstructionErrors(errors);
    },
    complete(errors) {
      if (complete) throw new Error("Structural method physical storage completes exactly once.");
      const normalize = (carrier: TargetTypeRef): TargetTypeRef => mapRustTargetTypes(carrier, current => {
        const reference = rustProducerErrorReference(current);
        if (reference === undefined) return current;
        const selected = errors.producerError(reference);
        if (selected === undefined) throw new Error("Structural method storage lost its completed producer error channel.");
        producerErrors.set(reference, selected);
        return selected;
      });
      const candidates = new Map<RustStructuralMethodRoot, readonly TargetTypeRef[]>();
      for (const root of roots) {
        const selected = sourceStorage.storageProducersFor(root.subject, root.bindings);
        if (selected.kind !== "complete") throw new Error(selected.kind === "unresolved" ? selected.reason
          : "Structural method storage requires its complete admitted source producers.");
        const field = structuralShapes.field(root.carrier, root.index)!;
        const storage = field.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier;
        const protocol = rustCallableProtocol(storage)!;
        const signatures: TargetTypeRef[] = [];
        for (const producer of selected.producers) {
          const subject = producer.subject;
          const operation = records.targetOperation.get(subject.node);
          if (subject.kind !== "value" || subject.projection.length !== 0 || operation?.kind !== "closure")
            throw new Error("Structural method storage requires its exact admitted closure producer.");
          const logical = records.receiverIndependentMethod.get(subject.node)?.carrier ?? operation.resultCarrier;
          const physical = input.nativeProducers.physicalFor(subject.node, logical);
          const source = physical === undefined ? undefined : rustNativeCallablePhysicalSource(logical,
            { kind: "identity", carrier: physical }, input.typeDefinitions);
          const owner = sourceEnclosingCallable(ast.parent(subject.node), ast);
          const bound = owner === undefined ? undefined : input.nativeStorage.genericBindingsFor(owner, producer.bindings);
          if (bound?.kind === "unresolved") throw new Error(bound.reason);
          if (source === undefined || protocol.lifetime === undefined)
            throw new Error("Structural method storage requires its existing physical callable signature and destination lifetime.");
          const captures = records.closureCapture.get(subject.node);
          if (captures === undefined) throw new Error("Structural method storage requires its admitted closure capture inventory.");
          const captureCarriers = [...captures.captures, ...captures.receiverFields, ...captures.receivers].map(capture =>
            bound === undefined ? capture.carrier : substituteRustTargetGenerics(capture.carrier,
              bound.bindings.types, bound.bindings.lifetimes, bound.bindings.consts));
          const retained = rustRetainedValueLifetime(subject.node, captureCarriers, { context: {
            ast, records, sourceLifetimes: input.lifetimes, retainedEnvironments: input.retainedEnvironments,
          } });
          if (retained === undefined || protocol.lifetime.kind !== "placeholder" && !rustLifetimeOutlives(retained,
            protocol.lifetime, rustEnclosingStorageContract(subject.node, ast, input.lifetimes))) {
            if (protocol.lifetime.kind !== "static" || !captureCarriers.some(rustHasOpenOwnedStorage))
              throw new Error("Structural method storage lost its admitted retained-lifetime correspondence.");
            retainedRequirements.push(Object.freeze({ declaration: subject.node, captures: Object.freeze(captureCarriers) }));
          }
          let carrier = rustCallableTargetType(source.signature.parameters, source.signature.result,
            protocol.lifetime, source.signature.error);
          if (bound !== undefined) carrier = substituteRustTargetGenerics(carrier,
            bound.bindings.types, bound.bindings.lifetimes, bound.bindings.consts);
          carrier = normalize(carrier);
          const signature = rustCallableProtocol(carrier)!;
          if (signature.parameters.length !== protocol.parameters.length)
            throw new Error("Structural method storage lost its admitted receiver correspondence.");
          const parameters = [...signature.parameters];
          if (field.receiverIndependent !== true) {
            if (!rustTargetTypeRefEquals(parameters[0], root.carrier))
              throw new Error("Structural method storage requires its exact selected receiver carrier.");
            parameters[0] = root.carrier;
          }
          const stored = rustCallableTargetType(parameters, signature.result, protocol.lifetime, signature.error);
          signatures.push(field.presence === "optional" ? rustOptionTargetType(stored) : stored);
        }
        if (signatures.length === 0) throw new Error("Structural method storage cannot invent an ABI for an empty producer set.");
        candidates.set(root, Object.freeze(signatures));
      }
      const selections = new Map<RustStructuralShapeDefinition, Map<number, TargetTypeRef>>();
      for (const root of roots) {
        const source = rustStructuralGenericCarrier(root.carrier).carrier;
        const refs = rustTargetGenericReferences(source);
        const shape = rustStructuralObjectCarrierValue(source)!;
        const aligned = rustStructuralObjectTargetType(root.definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
        const bindings = inferRustTargetGenericBindings(aligned, root.definition.carrier, {
          typeIdentities: new Set(refs.typeIdentities), lifetimeIdentities: new Set(refs.lifetimeIdentities), constIdentities: new Set(refs.constIdentities),
        });
        const exactBindings = bindings !== undefined && rustTargetTypeRefEquals(substituteRustTargetGenerics(aligned,
          bindings.types, bindings.lifetimes, bindings.consts), root.definition.carrier) ? bindings : undefined;
        const fields = selections.get(root.definition) ?? new Map<number, TargetTypeRef>();
        selections.set(root.definition, fields);
        for (const candidate of candidates.get(root)!) {
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
          if (templateProtocol.lifetime === undefined) throw new Error("Structural method template requires its admitted destination lifetime.");
          const parameters = mappedProtocol.parameters.map((parameter, index) =>
            rustTargetTypeRefEquals(actualProtocol.parameters[index], sourceProtocol.parameters[index])
              ? templateProtocol.parameters[index]! : parameter);
          const result = rustTargetTypeRefEquals(actualProtocol.result, sourceProtocol.result)
            ? templateProtocol.result : mappedProtocol.result;
          const carrier = rustCallableTargetType(parameters, result,
            templateProtocol.lifetime, mappedProtocol.error);
          const selected = templateField.presence === "optional" ? rustOptionTargetType(carrier) : carrier;
          const existing = fields.get(root.index);
          if (existing !== undefined && !rustTargetTypeRefEquals(existing, selected))
            throw new Error("Structural method storage has incompatible admitted physical signatures.");
          fields.set(root.index, selected);
        }
      }
      for (const root of roots) {
        const template = selections.get(root.definition)?.get(root.index);
        if (template === undefined) throw new Error("Structural method storage requires its own canonical template contribution.");
        const refs = root.definition.genericParameters;
        const shape = rustStructuralObjectCarrierValue(root.carrier)!;
        const aligned = rustStructuralObjectTargetType(root.definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
        const bindings = inferRustTargetGenericBindings(root.definition.carrier, aligned, {
          typeIdentities: new Set(refs.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : [])),
          lifetimeIdentities: new Set(rustTargetGenericReferences(root.definition.carrier).lifetimeIdentities), constIdentities: new Set(),
        });
        if (bindings === undefined) throw new Error("Structural method storage lost its forward template application.");
        const expected = substituteRustTargetGenerics(template, bindings.types, bindings.lifetimes, bindings.consts,
          (carrier, original) => rustTargetTypeRefEquals(original, root.definition.carrier) ? root.carrier : carrier);
        for (const candidate of candidates.get(root)!) {
          if (!rustTargetTypeRefEquals(expected, candidate))
            throw new Error("Structural method storage does not match its exact forward-applied physical template.");
        }
      }
      structuralShapes.finalizeMethodStorage(selections);
      complete = true;
    },
    validateErrors(errors: Pick<RustErrorRegionRecords, "producerError">) {
      if (!complete) throw new Error("Structural method error validation requires its complete physical field plan.");
      for (const [reference, carrier] of producerErrors) {
        if (!rustTargetTypeRefEquals(errors.producerError(reference), carrier))
          throw new Error("Structural method storage changed its selected intrinsic error layout after physical materialization.");
      }
    },
    validateRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
      families: Pick<RustSourceTypeFamilyRegistry, "implementation">) {
      if (!complete || retentionValidated) throw new Error("Structural retention validates once against the completed declaration requirements.");
      for (const requirement of retainedRequirements) {
        const contract = requirements.contractFor(requirement.declaration);
        if (contract === undefined || !requirement.captures.every(carrier =>
          rustFinalContractSupportsStatic(contract, carrier, families, input.typeDefinitions)))
          throw new Error("Structural method retention is not proven by its actual final native generic contract.");
      }
      retentionValidated = true;
    },
  });
}
