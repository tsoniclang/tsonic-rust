import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { RustProjectFieldSelection } from "../../../target-model/records/objects/project-fields.js";
import type { Node, Type } from "@tsonic/tsts";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { rustSourceStorageSubjectContext } from "../../source-evidence/types/resolution/source-storage-projection.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustProjectObjectField } from "../../project-types/object-layout.js";

import { instantiateRustSelectedMemberCarrier } from "./member-carriers.js";
import type { RustOperationsProviderOptions } from "./model.js";

export function resolveRustProjectField(
  declaration: Node,
  receiverCarrier: TargetTypeRef,
  receiverType: Type | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustProjectFieldSelection | undefined {
  const field = rustProjectObjectField(declaration, options.projectTypes);
  const declared = context.records.runtimeCarrier.get(declaration)?.carrier ??
    resolveRustTargetTypeRef(declaration, rustSourceStorageSubjectContext(context,
      context.sourceStorage.memberSubjectFor(declaration)), options);
  const resultCarrier = declared === undefined ? undefined : instantiateRustSelectedMemberCarrier(
    declaration, receiverCarrier, receiverType, declared, context, options);
  const owner = options.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined ? undefined : options.projectTypes.relationship(receiverCarrier, owner);
  if (field === undefined || resultCarrier === undefined || relationship?.kind !== "related") return undefined;
  const alias = options.receiverFieldAliases.aliasFor(declaration);
  if (alias !== undefined) {
    const resultOwner = options.projectTypes.definitionForCarrier(resultCarrier);
    const aliasRelationship = resultOwner === undefined ? undefined
      : options.projectTypes.relationship(receiverCarrier, resultOwner);
    if (aliasRelationship?.kind !== "related" ||
      !rustTargetTypeRefEquals(aliasRelationship.targetType, resultCarrier)) return undefined;
  }
  const polymorphic = options.projectTypes.isPolymorphic(owner!);
  const read = polymorphic ? options.projectTypes.memberSlotName(declaration, "read") : undefined;
  const write = polymorphic ? options.projectTypes.memberSlotName(declaration, "write") : undefined;
  if (polymorphic && (read === undefined || write === undefined)) return undefined;
  return {
    kind: "source-field", declaration, receiverCarrier, storage: "project-object",
    storageIndex: field.storageIndex + (options.projectTypes.externalBaseForDefinition(owner!)?.fields.length ?? 0),
    valueSemantics: alias === undefined
      ? { kind: "stored" } : { kind: "receiver-alias" }, resultCarrier,
    ...(read === undefined || write === undefined ? {} : { dispatch: { read, write, ownerCarrier: relationship.targetType } }),
  };
}
