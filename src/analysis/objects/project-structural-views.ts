import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustProjectField, type RustProjectFieldSelection } from "../operations/provider/project-fields.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustClassValueCallable, type RustClassValueCallable } from "./class-value-callables.js";
import { isRustErasedNominalMember } from "../../policy/types/source-shapes.js";
import { resolveRustProjectAccessor, type RustProjectAccessorSelection } from "../operations/provider/project-accessors.js";
import { selectRustCallableValueAdapter } from "../callables/adapters.js";
import type { RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { inferRustTargetTypeParameterBindings, rustTargetGenericReferences, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { RustAnalysisContext } from "../program/context.js";

export interface RustProjectStructuralView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly {
    readonly declaration: Node;
    readonly storageIndex: number;
    readonly field?: RustProjectFieldSelection;
    readonly accessor?: RustProjectAccessorSelection;
    readonly readAdapter?: RustCallableValueAdapter;
    readonly callable?: RustClassValueCallable;
  }[];
}

export function selectRustProjectStructuralView(
  walk: RustFactWalk, declaration: Node, sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef, semantics: SourceFileSemantics, sourceType: Type,
): boolean {
  const target = walk.sourceTypes.structuralObjectForCarrier(targetCarrier);
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  if (target === undefined || target.construction !== undefined || definition?.kind !== "class" ||
    walk.context.objectRepresentations.representationFor(definition)?.kind === "value") return false;
  const correspondence = semantics.types.structuralMembers(sourceType, target.sourceType);
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0 ||
    correspondence.members.filter(member => !isRustErasedNominalMember(member.destination.declarations, walk.context.ast)).length !== target.fields.length) return false;
  const fields: RustProjectStructuralView["fields"][number][] = [];
  const context = rustOperationContext(walk, declaration);
  for (const field of target.fields) {
    const pair = correspondence.members.find(candidate => field.symbols.includes(candidate.destination.property.symbol));
    if (pair?.kind !== "present") return false;
    const member = pair.source.getters[0] ?? pair.source.declarations[0];
    if (member === undefined) return false;
    if (field.method) {
      const sourceSignatures = semantics.types.callSignatures(pair.source.property.type);
      const destinationSignatures = semantics.types.callSignatures(pair.destination.property.type);
      const callable = sourceSignatures.length === 1 && destinationSignatures.length === 1
        ? selectRustClassValueCallable(walk, declaration, sourceSignatures[0]!, destinationSignatures[0]!, field.resultCarrier, false, semantics, true, sourceCarrier)
        : undefined;
      if (callable === undefined) return false;
      fields.push({ declaration: member, storageIndex: field.storageIndex, callable });
    } else if (pair.source.read === "accessor") {
      if (pair.source.getters.length !== 1 || pair.source.setters.length > 1 || !field.readonly && pair.source.setters.length !== 1) return false;
      const accessor = resolveRustProjectAccessor({ readDeclaration: pair.source.getters[0],
        ...(!field.readonly ? { writeDeclaration: pair.source.setters[0] } : {}), sourceReceiverType: sourceType,
        sourceReadType: pair.source.property.type, sourceWriteType: pair.source.property.type }, sourceCarrier, context, walk.operationOptions);
      const readAdapter = accessor?.read === undefined ? undefined : selectRustCallableValueAdapter(
        accessor.read.resultCarrier, field.resultCarrier, walk.context.projectTypes, walk.context.typeDefinitions);
      if (accessor === undefined || readAdapter === undefined || !field.readonly &&
        !rustTargetTypeRefEquals(accessor.write?.valueCarrier, field.resultCarrier)) return false;
      fields.push({ declaration: member, storageIndex: field.storageIndex, accessor, readAdapter });
    } else {
      if (pair.source.declarations.length !== 1) return false;
      const selected = resolveRustProjectField(member, sourceCarrier, sourceType, pair.source.property.type, context, walk.operationOptions);
      const readAdapter = selected === undefined ? undefined : selectRustCallableValueAdapter(
        selected.resultCarrier, field.resultCarrier, walk.context.projectTypes, walk.context.typeDefinitions);
      if (selected === undefined || readAdapter === undefined || !field.readonly && !rustTargetTypeRefEquals(selected.resultCarrier, field.resultCarrier) ||
        pair.source.property.readonly && !field.readonly) return false;
      fields.push({ declaration: member, storageIndex: field.storageIndex, field: selected, readAdapter });
    }
  }
  if (!walk.context.classValues.recordInstanceView({ declaration, sourceCarrier, targetCarrier, fields })) return false;
  return fields.every(field => walk.sourceTypes.registerStructuralFieldImplementation({
    carrier: targetCarrier, storageIndex: field.storageIndex, kind: "dispatch",
  }) && (field.accessor === undefined || walk.sourceTypes.registerStructuralFieldImplementation({
    carrier: targetCarrier, storageIndex: field.storageIndex, kind: "accessor",
  })));
}

export interface RustProjectStructuralViewImplementation extends RustProjectStructuralView {
  readonly ownerFileName: string;
}

export function selectRustStructuralViewImplementations(
  views: readonly RustProjectStructuralView[], context: RustAnalysisContext,
): readonly RustProjectStructuralViewImplementation[] {
  const ordered = [...views].sort((left, right) =>
    rustTargetGenericReferences(right.sourceCarrier).typeNames.length - rustTargetGenericReferences(left.sourceCarrier).typeNames.length);
  const selected: RustProjectStructuralView[] = [];
  for (const view of ordered) {
    const covered = selected.some(candidate => {
      if (candidate.declaration !== view.declaration || candidate.fields.length !== view.fields.length ||
        candidate.fields.some((field, index) => field.declaration !== view.fields[index]?.declaration || field.storageIndex !== view.fields[index]?.storageIndex)) return false;
      const parameters = new Set(rustTargetGenericReferences(candidate.sourceCarrier).typeNames);
      const bindings = inferRustTargetTypeParameterBindings(candidate.sourceCarrier, view.sourceCarrier, parameters);
      return bindings !== undefined && bindings.size === parameters.size &&
        rustTargetTypeRefEquals(substituteRustTargetTypeParameters(candidate.sourceCarrier, bindings), view.sourceCarrier) &&
        rustTargetTypeRefEquals(substituteRustTargetTypeParameters(candidate.targetCarrier, bindings), view.targetCarrier);
    });
    if (!covered) selected.push(view);
  }
  const component = (file: string): string | undefined => context.sourcePackages.packages.find(entry => entry.sourceFiles.includes(file))?.componentId;
  return Object.freeze(selected.map(view => {
    const sourceFile = context.ast.getFileName(context.ast.getSourceFile(view.declaration));
    const targetFile = rustStructuralObjectCarrierValue(view.targetCarrier)?.ownerFileName;
    if (targetFile === undefined) throw new Error("A structural implementation has no exact target owner.");
    return Object.freeze({ ...view, ownerFileName: component(sourceFile) === component(targetFile) ? sourceFile : targetFile });
  }));
}
