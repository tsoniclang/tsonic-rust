import type { TargetTypeRef } from "../../policy/types.js";
import type { RustProviderOperationTemplate } from "../rust-facts/keys.js";
import {
  getRustGeneratorProtocol,
  getRustIteratorResultProtocol,
  rustIteratorResultTargetType,
  rustSourcePrimitiveTargetType,
} from "../rust-target-types.js";

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
  | { readonly kind: "rejected"; readonly message: string }
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
  const protocol = getRustGeneratorProtocol(request.receiverCarrier);
  const expectedKind = request.ownerName === "Generator" ? "sync" : "async";
  if (protocol?.kind !== expectedKind) {
    return rejected(`${request.ownerName}.${request.memberName} has no closed matching Rust generator receiver protocol.`);
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
        mutatesReceiver: protocol.kind === "sync",
      },
      resultCarrier,
      parameterCarriers,
      isAsync: protocol.kind === "async",
      isFallible: false,
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
        mutatesReceiver: protocol.kind === "sync",
      },
      resultCarrier,
      parameterCarriers: [protocol.returnType],
      isAsync: protocol.kind === "async",
      isFallible: false,
    }, [protocol.returnType]);
  }
  if (request.memberName === "throw") {
    const errorCarrier = request.argumentCarriers[0];
    if (request.selectedParameterCount !== 1 || request.argumentCarriers.length !== 1 ||
      errorCarrier?.kind !== "target-named" || errorCarrier.id !== "rust.runtime.JsError") {
      return rejected("Generator.throw requires one exact closed Rust JsError carrier.");
    }
    return resolved({
      kind: "provider-operation",
      operationId: `tsonic.rust.generator.throw.${protocol.kind}`,
      operationKind: "method",
      target: {
        form: "receiver-method",
        name: "throw_value",
        mutatesReceiver: protocol.kind === "sync",
      },
      resultCarrier,
      parameterCarriers: [errorCarrier],
      isAsync: protocol.kind === "async",
      isFallible: true,
    }, [errorCarrier]);
  }
  return rejected(`The exact selected ${request.ownerName}.${request.memberName} signature has no Rust generator operation.`);
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
    return rejected(`${sourceMember.ownerName}.${sourceMember.memberName} has no closed Rust iterator-result receiver protocol.`);
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
    }, []);
  }
  return rejected(`The exact selected iterator-result '${sourceMember.memberName}' property set has no Rust operation.`);
}

function resolved(
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly TargetTypeRef[],
): RustGeneratorSourceSelection {
  return { kind: "resolved", template, parameterCarriers };
}

function rejected(message: string): RustGeneratorSourceSelection {
  return { kind: "rejected", message };
}
