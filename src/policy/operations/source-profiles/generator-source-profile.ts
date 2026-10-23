import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import { getRustGeneratorProtocol, getRustIteratorResultProtocol, rustIteratorResultTargetType, rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { jsSourceCallableRefusal } from "@tsonic/js-source-profile";

export interface RustGeneratorSourceCallRequest {
  readonly ownerName: string;
  readonly memberName: string;
  readonly receiverCarrier?: TargetTypeRef;
  readonly selectedParameterCount: number;
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
}

export interface RustGeneratorSourcePropertyRequest {
  readonly sourceMembers: readonly {
    readonly ownerName: string;
    readonly memberName: string;
  }[];
  readonly receiverCarrier?: TargetTypeRef;
}

export type RustGeneratorSourceSelection =
  | { readonly kind: "not-applicable" }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string }
  | {
      readonly kind: "resolved";
      readonly template: RustProviderOperationTemplate;
      readonly parameterCarriers: readonly TargetTypeRef[];
    };

const generatorOwners = new Set(["Generator", "AsyncGenerator"]);
const iteratorResultOwners = new Set([
  "IteratorYieldResult",
  "IteratorReturnResult",
]);

export function selectRustGeneratorSourceCall(
  request: RustGeneratorSourceCallRequest,
): RustGeneratorSourceSelection {
  if (!generatorOwners.has(request.ownerName)) {
    return { kind: "not-applicable" };
  }
  const refusal = jsSourceCallableRefusal(request);
  if (refusal !== undefined) return { kind: "rejected", ...refusal };
  const protocol = getRustGeneratorProtocol(request.receiverCarrier);
  const expectedKind = request.ownerName === "Generator" ? "sync" : "async";
  if (protocol?.kind !== expectedKind) {
    return rejected("RUST_GENERATOR_SOURCE_CALL_NOT_CLOSED", `${request.ownerName}.${request.memberName} has no closed matching Rust generator receiver protocol.`);
  }
  const resultCarrier = rustIteratorResultTargetType(protocol);
  if (request.memberName === "next" &&
    (request.selectedParameterCount === 0 || request.selectedParameterCount === 1)) {
    const parameterCarriers = request.selectedParameterCount === 0 ? [] : [protocol.nextType];
    return resolved({
      kind: "provider-operation",
      operationId: `tsonic.rust.generator.next.${protocol.kind}.${request.selectedParameterCount}`,
      operationKind: "method",
      target: {
        form: "receiver-method",
        name: request.selectedParameterCount === 0 ? "resume" : "resume_with",
        mutatesReceiver: false,
      },
      resultCarrier,
      parameterCarriers,
      isAsync: protocol.kind === "async",
      isFallible: false,
      errorBoundary: "none",
    }, parameterCarriers);
  }
  if (request.memberName === "return" && request.selectedParameterCount === 1) {
    return resolved({
      kind: "provider-operation",
      operationId: `tsonic.rust.generator.return.${protocol.kind}`,
      operationKind: "method",
      target: {
        form: "receiver-method",
        name: "return_value",
        mutatesReceiver: false,
      },
      resultCarrier,
      parameterCarriers: [protocol.returnType],
      isAsync: protocol.kind === "async",
      isFallible: false,
      errorBoundary: "none",
    }, [protocol.returnType]);
  }
  return rejected("RUST_GENERATOR_SOURCE_CALL_NOT_CLOSED", `The exact selected ${request.ownerName}.${request.memberName} signature has no Rust generator operation.`);
}

export function selectRustGeneratorSourceProperty(
  request: RustGeneratorSourcePropertyRequest,
): RustGeneratorSourceSelection {
  const sourceMember = request.sourceMembers[0];
  if (sourceMember === undefined ||
    request.sourceMembers.some((member) =>
      !iteratorResultOwners.has(member.ownerName) ||
      member.memberName !== sourceMember.memberName)) {
    return { kind: "not-applicable" };
  }
  const protocol = getRustIteratorResultProtocol(request.receiverCarrier);
  if (protocol === undefined) {
    return rejected("RUST_GENERATOR_SOURCE_PROPERTY_NOT_CLOSED", `${sourceMember.ownerName}.${sourceMember.memberName} has no closed Rust iterator-result receiver protocol.`);
  }
  const ownerNames = new Set(request.sourceMembers.map((member) => member.ownerName));
  const combined = ownerNames.size === 2 &&
    ownerNames.has("IteratorYieldResult") &&
    ownerNames.has("IteratorReturnResult");
  const singleOwner = ownerNames.size === 1 ? sourceMember.ownerName : undefined;
  if (sourceMember.memberName === "done" && (combined || singleOwner !== undefined)) {
    return resolved({
      kind: "provider-operation",
      operationId: `tsonic.rust.generator.result.${combined ? "combined" : singleOwner}.done`,
      operationKind: "property",
      target: { form: "method", name: "done" },
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    }, []);
  }
  if (sourceMember.memberName === "value" && singleOwner !== undefined) {
    const resultCarrier = singleOwner === "IteratorYieldResult"
      ? protocol.yieldType
      : protocol.returnType;
    return resolved({
      kind: "provider-operation",
      operationId: `tsonic.rust.generator.result.${singleOwner}.value`,
      operationKind: "property",
      target: {
        form: "method",
        name: singleOwner === "IteratorYieldResult" ? "yield_value" : "completed_value",
      },
      resultCarrier,
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    }, []);
  }
  return rejected("RUST_GENERATOR_SOURCE_PROPERTY_NOT_CLOSED", `The exact selected iterator-result '${sourceMember.memberName}' property set has no Rust operation.`);
}

function resolved(
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly TargetTypeRef[],
): RustGeneratorSourceSelection {
  return { kind: "resolved", template, parameterCarriers };
}

function rejected(code: string, message: string): RustGeneratorSourceSelection {
  return { kind: "rejected", code, message };
}
