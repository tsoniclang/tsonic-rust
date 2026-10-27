import type { Node, Type, TypeSignatureInfo } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustProjectField } from "../operations/members/project-fields.js";
import type { RustProjectFieldSelection } from "../../target-model/records/objects/project-fields.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustClassValueCallable } from "./class-value-callables.js";
import type { RustClassValueCallable } from "../../target-model/records/callables/class-value-callables.js";
import { isRustErasedNominalMember } from "../../policy/types/objects/source-shapes.js";
import { resolveRustProjectAccessor } from "../operations/members/project-accessors.js";
import type { RustProjectAccessorSelection } from "../../target-model/records/objects/project-accessors.js";
import { selectRustCallableValueAdapter } from "../../policy/conversions/callable-adapters.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import type { RustSourceObjectShape } from "../../target-model/records/types/source-types.js";
import { instantiateRustSelectedMemberCarrier } from "../operations/members/member-carriers.js";
import { rustSourceStorageScope, rustSourceStorageSubjectContext } from "../source-evidence/types/resolution/source-storage-projection.js";
import type { RustProjectStructuralView } from "../../target-model/records/objects/project-structural-views.js";

export type RustProjectStructuralViewSource = {
  readonly declaration: Node;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
} & (
  | { readonly kind: "field"; readonly field: RustProjectFieldSelection }
  | { readonly kind: "accessor"; readonly accessor: RustProjectAccessorSelection }
  | { readonly kind: "method"; readonly callable: RustClassValueCallable;
      readonly classDeclaration: Node; readonly ownerCarrier: TargetTypeRef;
      readonly sourceSignature: TypeSignatureInfo; readonly destinationSignature: TypeSignatureInfo }
);

export function selectRustProjectStructuralViewSources(
  walk: RustFactWalk, sourceCarrier: TargetTypeRef, target: RustSourceObjectShape,
  semantics: SourceFileSemantics, sourceType: Type,
): readonly RustProjectStructuralViewSource[] | undefined {
  const correspondence = semantics.types.structuralMembers(sourceType, target.sourceType, "read");
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0 ||
    correspondence.members.filter(member => !isRustErasedNominalMember(member.destination.declarations, walk.context.ast)).length !== target.fields.length) return undefined;
  const sources: RustProjectStructuralViewSource[] = [];
  for (const field of target.fields) {
    const pair = correspondence.members.find(candidate => field.symbols.includes(candidate.destination.property.symbol));
    if (pair?.kind !== "present") return undefined;
    const member = pair.source.getters[0] ?? pair.source.declarations[0];
    if (member === undefined) return undefined;
    const context = rustOperationContext(walk, member);
    if (field.method) {
      const sourceSignatures = semantics.types.signatureInfos(pair.source.property.type, "call");
      const destinationSignatures = semantics.types.signatureInfos(pair.destination.property.type, "call");
      if (sourceSignatures.length !== 1 || destinationSignatures.length !== 1) return undefined;
      const signatureDeclaration = semantics.declarations.signatureDeclaration(sourceSignatures[0]!.signature);
      const implementation = signatureDeclaration === undefined ? undefined
        : walk.context.source.navigation.callableImplementation(signatureDeclaration);
      if (implementation?.kind !== "resolved") return undefined;
      const nativeDeclaration = implementation.implementation.declaration;
      const owner = walk.context.projectTypes.definitionContainingDeclaration(nativeDeclaration);
      const relationship = owner === undefined ? undefined : walk.context.projectTypes.relationship(sourceCarrier, owner);
      if (owner?.kind !== "class" || relationship?.kind !== "related") return undefined;
      const ownerSemantics = walk.context.semanticsFor(nativeDeclaration);
      const declaredType = ownerSemantics.declarations.declaredValueType(nativeDeclaration);
      const declaredSignatures = declaredType === undefined ? [] : ownerSemantics.types.signatureInfos(declaredType, "call");
      if (declaredSignatures.length !== 1 ||
        ownerSemantics.declarations.signatureDeclaration(declaredSignatures[0]!.signature) !== signatureDeclaration) return undefined;
      const signatureScope = rustSourceStorageScope(walk.context, nativeDeclaration, nativeDeclaration);
      if (signatureScope.kind !== "resolved") return undefined;
      const declared = resolveRustTargetTypeRef(declaredType,
        rustSourceStorageSubjectContext({ ...rustOperationContext(walk, nativeDeclaration),
          sourceStorageResolution: signatureScope }, undefined), walk.operationOptions);
      const carrier = declared === undefined ? undefined : instantiateRustSelectedMemberCarrier(
        nativeDeclaration, sourceCarrier, sourceType, declared, rustOperationContext(walk, nativeDeclaration), walk.operationOptions);
      const callable = carrier === undefined ? undefined
        : selectRustClassValueCallable(walk, owner.declaration, declaredSignatures[0]!, declaredSignatures[0]!, carrier,
          ownerSemantics, true, relationship.targetType);
      if (callable === undefined || carrier === undefined) return undefined;
      sources.push({ kind: "method", declaration: member, storageIndex: field.storageIndex, carrier, callable,
        classDeclaration: owner.declaration, ownerCarrier: relationship.targetType,
        sourceSignature: declaredSignatures[0]!, destinationSignature: destinationSignatures[0]! });
    } else if (pair.source.read === "accessor") {
      if (pair.source.getters.length !== 1 || pair.source.setters.length > 1 || !field.readonly && pair.source.setters.length !== 1) return undefined;
      const accessor = resolveRustProjectAccessor({ readDeclaration: pair.source.getters[0],
        ...(!field.readonly ? { writeDeclaration: pair.source.setters[0] } : {}), sourceReceiverType: sourceType,
        sourceReadType: pair.source.property.type, sourceWriteType: pair.source.property.type }, sourceCarrier, context, walk.operationOptions);
      if (accessor?.read === undefined) return undefined;
      sources.push({ kind: "accessor", declaration: member, storageIndex: field.storageIndex,
        carrier: accessor.read.resultCarrier, accessor });
    } else {
      if (pair.source.declarations.length !== 1 || pair.source.property.readonly && !field.readonly) return undefined;
      const selected = resolveRustProjectField(member, sourceCarrier, sourceType, context, walk.operationOptions);
      if (selected === undefined) return undefined;
      sources.push({ kind: "field", declaration: member, storageIndex: field.storageIndex,
        carrier: selected.resultCarrier, field: selected });
    }
  }
  return sources;
}

export function selectRustProjectStructuralViewFields(
  sources: readonly RustProjectStructuralViewSource[], target: RustSourceObjectShape,
  walk: RustFactWalk,
): RustProjectStructuralView["fields"] | undefined {
  const fields: RustProjectStructuralView["fields"][number][] = [];
  for (const source of sources) {
    const field = target.fields.find(field => field.storageIndex === source.storageIndex);
    if (field === undefined) return undefined;
    if (source.kind === "method") {
      const callable = selectRustClassValueCallable(walk, source.classDeclaration, source.sourceSignature,
        source.destinationSignature, field.resultCarrier, walk.context.semanticsFor(source.callable.declaration), true, source.ownerCarrier);
      if (callable === undefined) return undefined;
      fields.push({ declaration: source.declaration, storageIndex: source.storageIndex, callable });
      continue;
    }
    const readAdapter = selectRustCallableValueAdapter(source.carrier, field.resultCarrier,
      walk.context.projectTypes, walk.context.typeDefinitions);
    if (readAdapter === undefined || !field.readonly && !rustTargetTypeRefEquals(
      source.kind === "field" ? source.carrier : source.accessor.write?.valueCarrier, field.resultCarrier)) return undefined;
    fields.push({ declaration: source.declaration, storageIndex: source.storageIndex, readAdapter,
      ...(source.kind === "field" ? { field: source.field } : { accessor: source.accessor }) });
  }
  return fields;
}
