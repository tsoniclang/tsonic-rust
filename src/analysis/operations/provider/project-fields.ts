import { Node_Type } from "@tsonic/target-api/source";
import type { Node, Type } from "@tsonic/tsts";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustProjectObjectField } from "../../project-types/object-layout.js";
import type { RustTargetOperationFact } from "../../facts/keys.js";
import { instantiateRustSelectedMemberCarrier } from "./member-carriers.js";
import type { RustOperationsProviderOptions } from "./model.js";

export type RustProjectFieldSelection = Omit<
  Extract<RustTargetOperationFact, { readonly kind: "source-field" }>, "operationId" | "accessMode"
>;

export function resolveRustProjectField(
  declaration: Node,
  receiverCarrier: TargetTypeRef,
  receiverType: Type | undefined,
  resultType: Type | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustProjectFieldSelection | undefined {
  const field = rustProjectObjectField(declaration, context.ast);
  const declared = resolveRustTargetTypeRef(Node_Type(context.ast, declaration) ?? resultType, context, options);
  const resultCarrier = declared === undefined ? undefined : instantiateRustSelectedMemberCarrier(
    declaration, receiverCarrier, receiverType, declared, context, options);
  const owner = options.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined ? undefined : options.projectTypes.relationship(receiverCarrier, owner);
  if (field === undefined || resultCarrier === undefined || relationship?.kind !== "related") return undefined;
  const polymorphic = options.projectTypes.isPolymorphic(owner!);
  const read = polymorphic ? options.projectTypes.memberSlotName(declaration, "read") : undefined;
  const write = polymorphic ? options.projectTypes.memberSlotName(declaration, "write") : undefined;
  if (polymorphic && (read === undefined || write === undefined)) return undefined;
  return {
    kind: "source-field", declaration, receiverCarrier, storage: "project-object",
    storageIndex: field.storageIndex + (options.projectTypes.externalBaseForDefinition(owner!)?.fields.length ?? 0),
    valueSemantics: { kind: "stored" }, resultCarrier,
    ...(read === undefined || write === undefined ? {} : { dispatch: { read, write, ownerCarrier: relationship.targetType } }),
  };
}
