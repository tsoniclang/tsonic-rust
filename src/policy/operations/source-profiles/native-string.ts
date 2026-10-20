import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import { rustStringTargetType, rustSourcePrimitiveTargetType, rustOptionTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function selectRustNativeStringOperation(name: string, receiverCarrier: TargetTypeRef | undefined, argumentCount: number): RustProviderOperationTemplate | undefined {
  const noArgument = name === "len" || name === "is_empty";
  const search = name === "find" || name === "rfind";
  const boolean = name === "is_empty" || name === "contains" || name === "starts_with" || name === "ends_with";
  const parameters = noArgument ? [] : [rustStringTargetType()];
  if ((!search && !boolean && name !== "len") || receiverCarrier === undefined ||
    !rustTargetTypeRefEquals(receiverCarrier, rustStringTargetType()) || argumentCount !== parameters.length) return undefined;
  const index = rustSourcePrimitiveTargetType("native-uint");
  return { kind: "provider-operation", operationId: `tsonic.rust.native-string.${name}`, operationKind: "method",
    target: { form: "receiver-method", name, argModes: parameters.map(() => "ref" as const) },
    parameterCarriers: parameters,
    resultCarrier: search ? rustOptionTargetType(index) : boolean ? rustSourcePrimitiveTargetType("bool") : index,
    isAsync: false, isFallible: false, errorBoundary: "none" };
}
