import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";
import { rustIndexedFieldTrait } from "../../target-model/types/carriers/indexed-fields.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { resolveRustIndexedField } from "../source-evidence/types/resolution/indexed-fields.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProgramRecordWriter } from "../program/records/model.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function selectRustIndexedCallKeys(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  arguments_: RustTargetGenericArgument[],
): boolean {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = selected.member.genericParameters ?? [];
  const keys = new Map<string, TargetTypeRef>();
  const location = callArguments[0] ?? selected.sourceDeclaration;
  if (location === undefined) return true;
  const context = rustResolutionContext(walk, location);
  const visit = (carrier: TargetTypeRef): boolean => {
    if (carrier.kind === "associated-type" && carrier.trait?.id === rustIndexedFieldTrait.id) {
      const argument = carrier.trait.genericArguments[0];
      if (argument?.kind !== "type" || argument.type.kind !== "type-parameter") return false;
      const ownerName = carrier.owner.kind === "type-parameter" ? carrier.owner.identity : undefined;
      const ownerIndex = ownerName === undefined ? -1 : parameters.findIndex(parameter => parameter.kind === "type" && parameter.targetIdentity === ownerName);
      const keyName = argument.type.identity;
      const keyIndex = parameters.findIndex(parameter => parameter.kind === "type" && parameter.targetIdentity === keyName);
      if (keyIndex < 0) return true;
      const owner = ownerIndex < 0 ? { kind: "type" as const, type: carrier.owner } : arguments_[ownerIndex];
      const ownerType = ownerIndex < 0 ? walk.sourceTypes.structuralObjectForCarrier(carrier.owner)?.sourceType
        : sourceArguments[ownerIndex]?.selectedType;
      if (ownerType === undefined && carrier.owner.kind === "type-parameter") return true;
      const keyType = sourceArguments[keyIndex]?.selectedType;
      if (ownerType === undefined || keyType === undefined || owner?.kind !== "type") return false;
      const field = resolveRustIndexedField(ownerType, keyType, context, walk.operationOptions, new Set(), owner.type);
      if (field === undefined || keys.has(keyName) && !rustTargetTypeRefEquals(keys.get(keyName), field.key)) return false;
      keys.set(keyName, field.key);
      arguments_[keyIndex] = { kind: "type", type: field.key };
    }
    return rustTargetTypeChildren(carrier).every(visit);
  };
  if (!selected.member.parameters.every(parameter => visit(parameter.type)) ||
    selected.member.returnType !== undefined && !visit(selected.member.returnType)) return false;
  return recordRustIndexedCallKeyArguments(walk.context.records, walk.context.requiredRecords, selected, callArguments, keys, argument => {
    const kind = walk.context.ast.kindName(argument);
    return kind !== "KindStringLiteral" && kind !== "KindNoSubstitutionTemplateLiteral";
  });
}

export function recordRustIndexedCallKeyArguments(
  records: RustProgramRecordWriter,
  requiredRecords: RustRequiredRecord[],
  selected: RustSelectedTargetSignature,
  arguments_: readonly Node[],
  keys: ReadonlyMap<string, TargetTypeRef>,
  evaluate: (argument: Node) => boolean,
): boolean {
  records.assertOpen();
  const selectedArguments = new Map<Node, { readonly carrier: TargetTypeRef; readonly evaluate: boolean }>();
  for (const binding of selected.sourceArgumentBindings ?? []) {
    const parameter = selected.member.parameters[binding.sourceParameterIndex];
    const argument = arguments_[binding.sourceArgumentIndex];
    const type = parameter?.type;
    const carrier = type?.kind === "type-parameter" ? keys.get(type.identity) : undefined;
    if (carrier === undefined || carrier.kind === "type-parameter") continue;
    if (argument === undefined || binding.sourceForm !== "value") return false;
    const prior = selectedArguments.get(argument);
    const incoming = prior === undefined ? { carrier, evaluate: evaluate(argument) } : { carrier, evaluate: prior.evaluate };
    requireRustRecord(requiredRecords, "indexedFieldKeyArgument", argument, "concrete indexed key", "recordRustIndexedCallKeyArguments");
    const existing = records.indexedFieldKeyArgument.get(argument);
    if (existing !== undefined && !closedMetadataEquals(existing, incoming)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.indexedFieldKeyArgument' for one exact source subject.", argument);
    }
    if (existing === undefined) records.indexedFieldKeys.selected(argument, carrier, incoming.evaluate);
    selectedArguments.set(argument, incoming);
  }
  return true;
}
