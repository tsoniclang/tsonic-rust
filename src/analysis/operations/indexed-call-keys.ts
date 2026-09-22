import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import type { RustSelectedTargetSignature, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { rustIndexedFieldTrait } from "../../target-model/types/carriers/indexed-fields.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { resolveRustIndexedField } from "../../policy/types/resolution/indexed-fields.js";
import { rustIndexedFieldKeyArgument } from "../facts/indexed-field-keys.js";

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
      const ownerName = carrier.owner.kind === "type-parameter" ? carrier.owner.name : undefined;
      const ownerIndex = ownerName === undefined ? -1 : parameters.findIndex(parameter => parameter.kind === "type" && parameter.sourceName === ownerName);
      const keyName = argument.type.name;
      const keyIndex = parameters.findIndex(parameter => parameter.kind === "type" && parameter.sourceName === keyName);
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
  for (const binding of selected.sourceArgumentBindings ?? []) {
    const parameter = selected.member.parameters[binding.sourceParameterIndex];
    const argument = callArguments[binding.sourceArgumentIndex];
    const type = parameter?.type;
    const carrier = type?.kind === "type-parameter" ? keys.get(type.name) : undefined;
    if (carrier === undefined || carrier.kind === "type-parameter") continue;
    if (argument === undefined || binding.sourceForm !== "value") return false;
    const kind = walk.context.ast.kindName(argument);
    walk.context.facts.set(argument, rustIndexedFieldKeyArgument, {
      carrier, evaluate: kind !== "KindStringLiteral" && kind !== "KindNoSubstitutionTemplateLiteral",
    }, [{ message: "rust exact checker-selected indexed field key argument" }]);
  }
  return true;
}
