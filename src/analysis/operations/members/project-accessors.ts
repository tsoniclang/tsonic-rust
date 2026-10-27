import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { RustProjectAccessorSelection } from "../../../target-model/records/objects/project-accessors.js";
import { Node_Type } from "@tsonic/target-api/source";
import type { Node, Type } from "@tsonic/tsts";

import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { instantiateRustSelectedMemberCarrier } from "./member-carriers.js";
import type { RustOperationsProviderOptions } from "./model.js";

export function resolveRustProjectAccessor(
  selection: {
    readonly readDeclaration?: Node;
    readonly writeDeclaration?: Node;
    readonly sourceReceiverType?: Type;
    readonly sourceReadType?: Type;
    readonly sourceWriteType?: Type;
  }, receiverCarrier: TargetTypeRef | undefined, context: RustOperationAnalysisContext, options: RustOperationsProviderOptions,
): RustProjectAccessorSelection | undefined {
  const { readDeclaration, writeDeclaration } = selection;
  const declarations = [readDeclaration, writeDeclaration].filter(declaration => declaration !== undefined);
  const owner = declarations[0] === undefined ? undefined : options.projectTypes.definitionContainingDeclaration(declarations[0]);
  const staticAccess = declarations[0] !== undefined && context.ast.hasModifierKind(declarations[0], "static");
  if (owner === undefined || declarations.some(declaration =>
    options.projectTypes.definitionContainingDeclaration(declaration) !== owner ||
    context.ast.hasModifierKind(declaration, "static") !== staticAccess) ||
    readDeclaration !== undefined && context.ast.kindName(readDeclaration) !== "KindGetAccessor" ||
    writeDeclaration !== undefined && context.ast.kindName(writeDeclaration) !== "KindSetAccessor") return undefined;
  const relationship = receiverCarrier === undefined ? undefined : options.projectTypes.relationship(receiverCarrier, owner);
  if (!staticAccess && relationship?.kind !== "related") return undefined;
  const instantiate = (declaration: Node, carrier: TargetTypeRef | undefined): TargetTypeRef | undefined =>
    carrier === undefined || staticAccess ? carrier : receiverCarrier === undefined ? undefined :
      instantiateRustSelectedMemberCarrier(declaration, receiverCarrier, selection.sourceReceiverType, carrier, context, options);
  const readCarrier = readDeclaration === undefined ? undefined : instantiate(readDeclaration,
    context.records.sourceCallableReturn.get(readDeclaration)?.returnCarrier ??
    resolveRustTargetTypeRef(Node_Type(context.ast, readDeclaration) ?? selection.sourceReadType, context, options));
  const parameters = writeDeclaration === undefined ? [] : context.ast.parameters(writeDeclaration);
  const writeParameter = writeDeclaration === undefined || parameters.length !== 1 ? undefined
    : options.sourceCallableAbi.resolveParameterAbi(parameters[0]!, context, options);
  if (writeParameter?.kind === "rejected") return undefined;
  const writeCarrier = writeDeclaration === undefined || writeParameter === undefined ? undefined
    : instantiate(writeDeclaration, writeParameter.abi.valueCarrier);
  const readMethod = readDeclaration === undefined ? undefined : options.projectTypes.memberSlotName(readDeclaration, "read");
  const writeMethod = writeDeclaration === undefined ? undefined : options.projectTypes.memberSlotName(writeDeclaration, "write");
  const resultCarrier = readCarrier ?? writeCarrier;
  if (resultCarrier === undefined || readDeclaration !== undefined && (readCarrier === undefined || readMethod === undefined) ||
    writeDeclaration !== undefined && (writeCarrier === undefined || writeMethod === undefined)) return undefined;
  return { kind: "source-accessor", resultCarrier,
    receiver: staticAccess ? { kind: "static", typeCarrier: options.projectTypes.openCarrier(owner) } : { kind: "instance" },
    ...(readDeclaration === undefined ? {} : { read: { declaration: readDeclaration, method: readMethod!, resultCarrier: readCarrier! } }),
    ...(writeDeclaration === undefined ? {} : { write: { declaration: writeDeclaration, method: writeMethod!, valueCarrier: writeCarrier! } }),
    ...(!staticAccess && relationship?.kind === "related" && options.projectTypes.isPolymorphic(owner)
      ? { dispatch: { ownerCarrier: relationship.targetType } } : {}),
  };
}
