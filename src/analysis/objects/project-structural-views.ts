import type { Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustProjectField, type RustProjectFieldSelection } from "../operations/provider/project-fields.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustClassValueCallable, type RustClassValueCallable } from "./class-value-callables.js";
import { isRustErasedNominalMember } from "../../policy/types/source-shapes.js";

export interface RustProjectStructuralView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly {
    readonly declaration: Node;
    readonly storageIndex: number;
    readonly field?: RustProjectFieldSelection;
    readonly callable?: RustClassValueCallable;
  }[];
}

export function selectRustProjectStructuralView(
  walk: RustFactWalk, declaration: Node, sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef, semantics: SourceFileSemantics,
): boolean {
  const target = walk.sourceTypes.structuralObjectForCarrier(targetCarrier);
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  if (target === undefined || target.construction !== undefined || definition?.kind !== "class" ||
    !walk.context.projectTypes.isPolymorphic(definition)) return false;
  const sourceType = semantics.declarations.declaredType(declaration);
  if (sourceType === undefined) return false;
  const correspondence = semantics.types.structuralMembers(sourceType, target.sourceType);
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0 ||
    correspondence.members.filter(member => !isRustErasedNominalMember(member.destination.declarations, walk.context.ast)).length !== target.fields.length) return false;
  const fields: RustProjectStructuralView["fields"][number][] = [];
  const context = rustOperationContext(walk, declaration);
  for (const field of target.fields) {
    const pair = correspondence.members.find(candidate => field.symbols.includes(candidate.destination.property.symbol));
    if (pair?.kind !== "present" || field.presence !== "required" || pair.source.declarations.length !== 1) return false;
    const member = pair.source.declarations[0]!;
    if (field.method) {
      const sourceSignatures = semantics.types.callSignatures(pair.source.property.type);
      const destinationSignatures = semantics.types.callSignatures(pair.destination.property.type);
      const callable = sourceSignatures.length === 1 && destinationSignatures.length === 1
        ? selectRustClassValueCallable(walk, declaration, sourceSignatures[0]!, destinationSignatures[0]!, field.resultCarrier, false, semantics, true)
        : undefined;
      if (callable === undefined) return false;
      fields.push({ declaration: member, storageIndex: field.storageIndex, callable });
    } else {
      const selected = resolveRustProjectField(member, sourceCarrier, sourceType, pair.source.property.type, context, walk.operationOptions);
      if (selected === undefined || !rustTargetTypeRefEquals(selected.resultCarrier, field.resultCarrier) ||
        pair.source.property.readonly && !field.readonly) return false;
      fields.push({ declaration: member, storageIndex: field.storageIndex, field: selected });
    }
  }
  if (!walk.context.classValues.recordInstanceView({ declaration, sourceCarrier, targetCarrier, fields })) return false;
  return fields.every(field => walk.sourceTypes.registerStructuralFieldImplementation({
    carrier: targetCarrier, storageIndex: field.storageIndex, kind: "dispatch",
  }));
}
