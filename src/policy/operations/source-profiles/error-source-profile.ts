import type { RustSelectedSourceMemberIdentity } from "../../evidence/selected-source.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceErrorConstructors } from "../../../target-model/identities/source-errors.js";
import { rustOptionalStringToBorrowedStrValueConversion } from "../../../target-model/conversions/model.js";
import { isRustAbsenceCarrier, rustJsErrorTargetType, rustSourceOptionalTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

type RustSourceErrorConstructor = typeof rustSourceErrorConstructors[number];

export function selectRustSourceErrorConstructor(
  member: RustSelectedSourceMemberIdentity | undefined,
  construction: boolean,
): RustSourceErrorConstructor | undefined {
  return member === undefined || member.memberName !== "call" &&
    (member.memberName !== "constructor" || !construction) ? undefined
    : rustSourceErrorConstructors.find(entry => entry.ownerName === member.ownerName &&
      (entry.sourceName === "Error" || member.profile === "js"));
}

export function rustSourceErrorConstructorOperation(
  constructor: RustSourceErrorConstructor,
  arguments_: readonly (TargetTypeRef | undefined)[],
): RustProviderOperationTemplate | undefined {
  if (arguments_.length > 1 || !rustSourceErrorConstructors.includes(constructor)) return undefined;
  const carrier = arguments_[0];
  const string = rustStringTargetType();
  const optional = rustSourceOptionalTargetType(string);
  const optionalMessage = isRustAbsenceCarrier(carrier) || rustTargetTypeRefEquals(carrier, optional);
  if (arguments_.length !== 0 && !optionalMessage && !rustTargetTypeRefEquals(carrier, string)) return undefined;
  const parameterCarriers = arguments_.length === 0 ? [] : [optionalMessage ? optional : string];
  return {
    kind: "provider-operation", operationId: constructor.operationId, operationKind: "constructor",
    target: {
      form: "call", path: constructor.path,
      argModes: arguments_.length === 0 ? [] : [optionalMessage ? "value" : "ref"],
      ...(optionalMessage ? { argConversions: [rustOptionalStringToBorrowedStrValueConversion] } : {}),
      ...(arguments_.length === 0 ? { trailingArguments: [{ kind: "string", value: "" } as const] } : {}),
    },
    parameterCarriers, resultCarrier: rustJsErrorTargetType(),
    isAsync: false, isFallible: false, errorBoundary: "none",
  };
}
