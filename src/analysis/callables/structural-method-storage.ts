import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorRegionRecords } from "../../target-model/records/error-regions.js";
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
import type { RustStructuralShapeDefinition, RustStructuralShapePlanRegistry } from "../objects/structural-shape-plan.js";
import { rustNativeCallablePhysicalSource } from "./native-conversions.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustNativeStoragePlan } from "./native-storage.js";

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
}): {
  complete(errors: Pick<RustErrorRegionRecords, "producerError">): void;
} {
  const { ast, records, sourceStorage, structuralShapes } = input;
  const canonical = new Map(structuralShapes.definitions.map(definition =>
    [`${definition.componentId}\0${definition.targetName}`, definition]));
  const roots: RustStructuralMethodRoot[] = [];
  const seen = new Map<SourceStorageSubject, Set<TargetTypeRef>>();
  const register = (node: Node, carrier: TargetTypeRef, index: number, subject: SourceStorageSubject): void => {
    const selected = structuralShapes.definitionForCarrier(carrier);
    const field = selected?.fields[index];
    const method = field?.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field?.methodStorageCarrier;
    if (selected === undefined || rustCallableProtocol(method) === undefined) return;
    const definition = canonical.get(`${selected.componentId}\0${selected.targetName}`);
    if (definition === undefined) throw new Error("Structural method storage requires its canonical shape owner.");
    const carriers = seen.get(subject) ?? new Set<TargetTypeRef>();
    if (carriers.has(carrier)) return;
    seen.set(subject, carriers);
    carriers.add(carrier);
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
        if (declarations.length === 0) declarations.push(...field.contractDeclarations);
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
  return Object.freeze({
    complete(errors) {
      if (complete) throw new Error("Structural method physical storage completes exactly once.");
      const normalize = (carrier: TargetTypeRef): TargetTypeRef => mapRustTargetTypes(carrier, current => {
        const reference = rustProducerErrorReference(current);
        if (reference === undefined) return current;
        const selected = errors.producerError(reference);
        if (selected === undefined) throw new Error("Structural method storage lost its completed producer error channel.");
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
        if (bindings === undefined || !rustTargetTypeRefEquals(substituteRustTargetGenerics(aligned,
          bindings.types, bindings.lifetimes, bindings.consts), root.definition.carrier)) continue;
        const fields = selections.get(root.definition) ?? new Map<number, TargetTypeRef>();
        selections.set(root.definition, fields);
        for (const candidate of candidates.get(root)!) {
          const mapped = substituteRustTargetGenerics(candidate, bindings.types, bindings.lifetimes, bindings.consts,
            (carrier, original) => rustTargetTypeRefEquals(original, root.carrier) ? root.definition.carrier : carrier);
          const templateField = root.definition.fields[root.index]!;
          const templateProtocol = rustCallableProtocol(templateField.presence === "optional"
            ? rustOptionElementCarrier(templateField.methodStorageCarrier) : templateField.methodStorageCarrier)!;
          const mappedProtocol = rustCallableProtocol(root.definition.fields[root.index]!.presence === "optional"
            ? rustOptionElementCarrier(mapped) : mapped)!;
          if (templateProtocol.lifetime === undefined) throw new Error("Structural method template requires its admitted destination lifetime.");
          const carrier = rustCallableTargetType(mappedProtocol.parameters, mappedProtocol.result,
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
  });
}
