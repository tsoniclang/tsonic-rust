import type { TargetTypeRef } from "../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType,
  rustTargetGenericReferences, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustProjectField } from "../operations/provider/project-fields.js";
import { resolveRustProjectAccessor } from "../operations/provider/project-accessors.js";
import type { RustSourceObjectShape } from "../project-types/source-type-registry.js";
import type { RustProjectStructuralView } from "./project-structural-views.js";
import { rustProjectViewMatches } from "./view-implementations.js";

export function generalizeRustProjectStructuralView(
  view: RustProjectStructuralView, target: RustSourceObjectShape, walk: RustFactWalk,
): RustProjectStructuralView | undefined {
  const projectTypes = walk.context.projectTypes;
  const definition = projectTypes.definitionForDeclaration(view.declaration);
  if (definition === undefined) return undefined;
  if (!projectTypes.isPolymorphic(definition)) return view;
  const sourceCarrier = projectTypes.openCarrier(definition);
  if (rustTargetTypeRefEquals(sourceCarrier, view.sourceCarrier)) return view;
  const retained = walk.context.classValues.instanceViewRequests().find(candidate => candidate.declaration === view.declaration &&
    rustTargetTypeRefEquals(candidate.sourceCarrier, sourceCarrier) && rustProjectViewMatches(candidate, view.sourceCarrier, view.targetCarrier) &&
    candidate.fields.length === view.fields.length && candidate.fields.every((member, index) =>
      member.declaration === view.fields[index]?.declaration && member.storageIndex === view.fields[index]?.storageIndex));
  if (retained !== undefined) return retained;
  const sourceType = walk.context.semanticsFor(view.declaration).declarations.declaredType(view.declaration);
  if (sourceType === undefined) return undefined;
  const context = rustOperationContext(walk, view.declaration);
  const fields: RustProjectStructuralView["fields"][number][] = [];
  for (const member of view.fields) {
    if (member.readAdapter?.kind !== "identity") return undefined;
    const field = member.field === undefined ? undefined
      : resolveRustProjectField(member.declaration, sourceCarrier, sourceType, context, walk.operationOptions);
    const accessor = member.accessor === undefined ? undefined : resolveRustProjectAccessor({
      readDeclaration: member.accessor.read?.declaration, writeDeclaration: member.accessor.write?.declaration,
      sourceReceiverType: sourceType,
    }, sourceCarrier, context, walk.operationOptions);
    const resultCarrier = field?.resultCarrier ?? accessor?.read?.resultCarrier;
    if (resultCarrier === undefined || member.field !== undefined && field === undefined ||
      member.accessor !== undefined && accessor === undefined ||
      accessor?.write !== undefined && !rustTargetTypeRefEquals(accessor.write.valueCarrier, resultCarrier)) return undefined;
    fields.push({ declaration: member.declaration, storageIndex: member.storageIndex,
      ...(field === undefined ? {} : { field }), ...(accessor === undefined ? {} : { accessor }),
      readAdapter: { kind: "identity", sourceCarrier: resultCarrier, targetCarrier: resultCarrier },
    });
  }
  let template = target.carrier;
  const visited: TargetTypeRef[] = [];
  const instantiations = walk.sourceTypes.structuralInstantiations();
  for (;;) {
    if (visited.some(carrier => rustTargetTypeRefEquals(carrier, template))) return undefined;
    visited.push(template);
    const parents = instantiations.filter(entry => rustTargetTypeRefEquals(entry.instance, template) &&
      !rustTargetTypeRefEquals(entry.template, template));
    if (parents.length === 0) break;
    if (parents.some(entry => !rustTargetTypeRefEquals(entry.template, parents[0]!.template))) return undefined;
    template = parents[0]!.template;
  }
  const shape = rustStructuralObjectCarrierValue(template);
  if (shape === undefined || shape.fields.length !== fields.length) return undefined;
  const selectedFields = shape.fields.map((entry, index) => {
    const selected = fields.find(member => member.storageIndex === index);
    return selected?.readAdapter === undefined ? undefined : { ...entry, type: selected.readAdapter.targetCarrier };
  });
  if (selectedFields.some(entry => entry === undefined)) return undefined;
  const bases = shape.bases.map(base => {
    const owner = projectTypes.definitionForCarrier(base);
    const relationship = owner === undefined ? undefined : projectTypes.relationship(sourceCarrier, owner);
    return relationship?.kind === "related" ? relationship.targetType : undefined;
  });
  if (bases.some(base => base === undefined)) return undefined;
  const targetCarrier = rustStructuralObjectTargetType(shape.ownerFileName,
    selectedFields as NonNullable<typeof selectedFields[number]>[], shape.representation, shape.construction,
    bases as NonNullable<typeof bases[number]>[]);
  const parameters = rustTargetGenericReferences(template);
  const bindings = inferRustTargetGenericBindings(template, targetCarrier, {
    typeIdentities: new Set(parameters.typeIdentities), lifetimeIdentities: new Set(parameters.lifetimeIdentities),
    constIdentities: new Set(parameters.constIdentities),
  });
  if (bindings === undefined || bindings.types.size !== parameters.typeIdentities.length ||
    bindings.lifetimes.size !== parameters.lifetimeIdentities.length || bindings.consts.size !== parameters.constIdentities.length ||
    !rustTargetTypeRefEquals(substituteRustTargetGenerics(template, bindings.types, bindings.lifetimes, bindings.consts), targetCarrier)) return undefined;
  const generalized = { declaration: view.declaration, sourceCarrier, targetCarrier, fields };
  return rustProjectViewMatches(generalized, view.sourceCarrier, view.targetCarrier) ? generalized : undefined;
}
