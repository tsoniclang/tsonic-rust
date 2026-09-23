import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustObjectReferenceViewKey, type RustObjectReferenceView } from "../facts/object-reference-views.js";
import { selectRustStructuralFieldProjection } from "../../policy/types/structural-fields.js";
import { selectRustProjectStructuralView } from "../objects/project-structural-views.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { selectRustClassValueView } from "../objects/class-values.js";

export function recordRustObjectReferenceView(
  walk: RustFactWalk, expression: Node, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef,
): boolean {
  const target = walk.sourceTypes.structuralObjectForCarrier(targetCarrier);
  const structural = rustStructuralObjectCarrierValue(targetCarrier);
  if (target === undefined || structural?.representation !== "reference" ||
    structural.fields.some(field => field.bound === true)) return false;
  const instance = rustClassConstructorInstance(sourceCarrier);
  if (instance !== undefined) {
    const definition = walk.context.projectTypes.definitionForCarrier(instance);
    if (definition?.kind !== "class" || !selectRustClassValueView(walk, expression, definition.declaration, targetCarrier)) return false;
    walk.context.facts.set(expression, rustObjectReferenceViewKey, {
      kind: "constructor", declaration: definition.declaration, sourceCarrier, targetCarrier,
    });
    return true;
  }
  const sourceStructural = rustStructuralObjectCarrierValue(sourceCarrier);
  const project = walk.context.projectTypes.definitionForCarrier(sourceCarrier);
  if (sourceStructural?.representation !== "reference" && project === undefined) return false;
  if (project !== undefined && walk.context.objectRepresentations.representationFor(project)?.kind === "value") return false;
  const semantics = walk.context.semanticsFor(expression);
  const sourceType = semantics.types.expressionType(expression);
  if (sourceType === undefined) return false;
  if (project !== undefined) {
    if (!selectRustProjectStructuralView(walk, project.declaration, sourceCarrier, targetCarrier, semantics, sourceType)) return false;
    walk.context.facts.set(expression, rustObjectReferenceViewKey, {
      kind: "project", declaration: project.declaration, sourceCarrier, targetCarrier,
    }, [{ message: "rust exact class-to-structural native root projection" }]);
    return true;
  }
  const correspondence = semantics.types.structuralMembers(sourceType, target.sourceType);
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0) return false;
  const fields: Extract<RustObjectReferenceView, { readonly kind: "structural" }>["fields"][number][] = [];
  const destinations = new Set<number>();
  for (const pair of correspondence.members) {
    if (pair.kind === "absent") return false;
    const destination = selectRustStructuralFieldProjection(walk.sourceTypes, pair.destination.property.symbol, pair.destination.declarations, targetCarrier);
    if (destination === undefined || destinations.has(destination.field.storageIndex)) return false;
    const source = selectRustStructuralFieldProjection(walk.sourceTypes, pair.source.property.symbol, pair.source.declarations, sourceCarrier);
    const selected: Extract<RustObjectReferenceView, { readonly kind: "structural" }>["fields"][number]["source"] | undefined = source === undefined
      ? undefined
      : { kind: "source-field", storage: source.shape.storage, storageIndex: source.field.storageIndex,
          receiverCarrier: sourceCarrier, resultCarrier: source.field.resultCarrier,
          valueSemantics: { kind: source.field.method === true ? "method" : "stored" } };
    if (selected === undefined || !rustTargetTypeRefEquals(selected.resultCarrier, destination.field.resultCarrier) ||
      source !== undefined && (source.field.method !== destination.field.method || source.field.presence !== destination.field.presence ||
        source.field.readonly && !destination.field.readonly)) return false;
    destinations.add(destination.field.storageIndex);
    fields.push({ destinationIndex: destination.field.storageIndex, source: selected, writable: !destination.field.readonly });
  }
  if (fields.length !== target.fields.length) return false;
  fields.sort((left, right) => left.destinationIndex - right.destinationIndex);
  for (const field of fields) {
    if (!walk.sourceTypes.registerStructuralFieldImplementation({carrier: targetCarrier,
      storageIndex: field.destinationIndex, kind: "accessor"})) return false;
  }
  walk.context.facts.set(expression, rustObjectReferenceViewKey,
    {kind: "structural", sourceCarrier, targetCarrier, fields: Object.freeze(fields)}, [{message: "rust exact identity-preserving structural view"}]);
  return true;
}
