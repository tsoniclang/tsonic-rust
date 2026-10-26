import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableErrorJoin, rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import { rustProducerErrorReference, type RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustNativeFutureCarrier } from "../../target-model/types/carriers/primitives.js";
import { rustSourceUnionCarrierValue, rustStructuralObjectCarrierName, rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustCallableJoinWrite } from "../../target-model/records/native-storage.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustStructuralShapeLayoutPlan } from "../objects/shapes/structural-shape-plan.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";

/** The selection state one native storage selection shares with its producer joins. */
export interface RustNativeStorageJoinContext {
  readonly input: {
    readonly storage: SourceStorageQueries;
    readonly definitions: RustTypeDefinitions;
    readonly structuralShapes: Pick<RustStructuralShapeLayoutPlan, "field" | "definitionForCarrier">;
    readonly producerErrorFor: (reference: RustProducerErrorReference) => TargetTypeRef | undefined;
  };
  readonly boundaries: readonly SourceStorageSubject[];
  readonly joinWrites: Map<Node, RustCallableJoinWrite>;
  readonly fail: (message: string) => undefined;
  readonly step: (depth: number) => boolean;
}

/** Producer error joins and callable containment for one native storage selection. */
export function createRustNativeStorageJoins(context: RustNativeStorageJoinContext) {
  const { input, boundaries, joinWrites, fail, step } = context;
  // Distinct callable producers reaching one storage share one boxed callable of their shared signature (RULINGS
  // ruling 2), selected once their errors are resolved. A value written into the storage carries the shared error
  // already, or its own error is uninhabited and the write eliminates it.
  const errorOf = (physical: TargetTypeRef): TargetTypeRef | undefined => {
    const error = rustCallablePhysicalSignature(physical)?.error;
    const reference = rustProducerErrorReference(error);
    return reference === undefined ? error : input.producerErrorFor(reference);
  };
  const shareProducers = (physicals: Iterable<TargetTypeRef>): TargetTypeRef | undefined => {
    const alternatives: { readonly physical: TargetTypeRef; readonly error: TargetTypeRef }[] = [];
    for (const physical of physicals) {
      const error = errorOf(physical);
      if (error === undefined) return fail("Native callable storage with distinct producers requires their resolved errors.");
      alternatives.push({ physical, error });
    }
    return rustCallableErrorJoin(alternatives)
      ?? fail("Native callable storage has distinct producers without one shared callable signature and error.");
  };
  const joinProducers = (selectedSubject: SourceStorageSubject, bindings: SourceStorageBindings, position: "value" | "input",
    alternatives: ReadonlyMap<SourceStorageSubject, TargetTypeRef>, absent: ReadonlySet<SourceStorageSubject>): TargetTypeRef | undefined => {
    const carrier = shareProducers(new Set(alternatives.values()));
    const shared = carrier === undefined ? undefined : errorOf(carrier);
    if (carrier === undefined || shared === undefined) return undefined;
    const incoming = input.storage.incomingFor(selectedSubject);
    if (incoming.kind === "unresolved") return fail(incoming.reason);
    for (const written of incoming.subjects) {
      if (!step(0)) return undefined;
      if (absent.has(written)) continue;
      let source = alternatives.get(written);
      if (source === undefined) {
        const reached = input.storage.boundValueFrontierFor(written, bindings, boundaries, position);
        if (reached.kind === "unresolved") return fail(reached.reason);
        const physicals = new Set<TargetTypeRef>();
        for (const frontier of reached.frontier) {
          if (absent.has(frontier.subject)) continue;
          const physical = alternatives.get(frontier.subject);
          if (physical === undefined) return fail("A shared callable storage write reaches a producer outside its storage.");
          physicals.add(physical);
        }
        source = physicals.size === 1 ? [...physicals][0] : shareProducers(physicals);
        if (source === undefined) return undefined;
      }
      const error = errorOf(source);
      if (error === undefined) return fail("A shared callable storage write requires its resolved error.");
      if (!rustUninhabitedError(error) || rustUninhabitedError(shared)) continue;
      if (written.kind !== "value" || written.projection.length !== 0)
        return fail("A shared callable storage write requires its exact written value.");
      const write: RustCallableJoinWrite = snapshotClosedMetadata({ source, carrier });
      const previous = joinWrites.get(written.node);
      if (previous !== undefined && closedMetadataKey(previous) !== closedMetadataKey(write))
        return fail("A callable value written into shared storage has one exact shared callable.");
      joinWrites.set(written.node, write);
    }
    return carrier;
  };
  const requiresPhysicalSelection = (type: TargetTypeRef, depth: number, active = new Set<TargetTypeRef>()): boolean | undefined => {
    if (!step(depth)) return undefined;
    if (active.has(type)) return false;
    active.add(type);
    try {
      if (type.kind === "closure" || type.kind === "function-pointer") return false;
      if (rustCallableProtocol(type) !== undefined || rustGenericCallableValue(type) !== undefined || isRustNativeFutureCarrier(type)) return true;
      const variants = rustUnionAlternatives(type, input.definitions);
      if (rustSourceUnionCarrierValue(type) !== undefined && (variants === undefined || variants.length === 0))
        return fail("Native storage TYPE demand requires its admitted source union payload inventory.");
      const shape = rustStructuralObjectCarrierValue(type);
      const children: TargetTypeRef[] = [];
      let required = false;
      let physical = false;
      if (type.kind === "target-specific" && type.target === "rust" && type.name === rustStructuralObjectCarrierName && shape === undefined)
        return fail("A structural value requires its actual checked physical layout owner.");
      if (shape !== undefined) {
        const definition = input.structuralShapes.definitionForCarrier(type);
        if (definition === undefined || definition.fields.length !== shape.fields.length)
          return fail("A structural value requires its actual checked physical layout owner.");
        physical = shape.implementation?.kind === "physical";
        if (physical && !rustTargetTypeRefEquals(type, definition.carrier))
          return fail("A physical structural carrier requires its exact admitted canonical definition.");
        children.push(...shape.bases);
        for (const [index, sourceField] of shape.fields.entries()) {
          const field = input.structuralShapes.field(type, index);
          if (field === undefined || field.sourceName !== sourceField.sourceName ||
            field.presence !== sourceField.presence || field.method !== sourceField.method) {
            fail("Native aggregate storage requires its exact structural field layout owner.");
            return undefined;
          }
          if (sourceField.method === true) {
            if (field.method !== true || field.methodPlan?.carrier === undefined) {
              fail("Native aggregate method storage requires its canonical callable field layout owner.");
              return undefined;
            }
            if (field.methodPlan.kind !== "native-dispatch") required = true;
          } else if (field.storage === "stored") children.push(sourceField.type);
        }
      } else children.push(...rustTargetTypeChildren(type));
      for (const child of [...children, ...(variants?.map(variant => variant.carrier) ?? [])]) {
        const selected = requiresPhysicalSelection(child, depth + 1, active);
        if (selected === undefined) return undefined;
        required = required || selected;
      }
      return physical ? false : required;
    } finally {
      active.delete(type);
    }
  };
  return { joinProducers, requiresPhysicalSelection };
}
