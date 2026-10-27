import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustNativeCallableInput } from "../../../target-model/records/native/native-protocols.js";
import type { RustNativeCallablePhysicalSource } from "../../../target-model/records/callables/callable-conversions.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { substituteRustCallableConversion } from "../../../target-model/conversions/substitution.js";
import { rustCallableInvocationSignaturesMatch } from "../../../policy/conversions/callable-input.js";
import { rustCallableConversionPhysical } from "../../../policy/conversions/callable-physical.js";
import { rustNativeCallablePhysicalSource, rustNativeCallableInputPhysicalSignature } from "../../../policy/conversions/native-callables.js";
import { rustValueCarrierBeforeContextualConversion } from "../../conversions/value-carrier-queries.js";
import { rustCallableClosureErrorBoundary } from "../../conversions/callable-error-boundary.js";
import { callableValueCarrier } from "./native-storage-values.js";
import type { createRustNativeStorageQueries } from "./native-storage.js";
import type { createRustNativeStorageGenericSelection } from "./native-storage-generics.js";

export function createRustNativeStorageAdaptation(input: {
  readonly context: Pick<Parameters<typeof createRustNativeStorageQueries>[0], "records" | "ast" | "frames" | "definitions" | "operationAttempts">;
  readonly genericsFor: ReturnType<typeof createRustNativeStorageGenericSelection>;
  readonly valueOwnerFor: (node: Node) => Node | undefined;
  readonly selectedInputs: ReadonlySet<RustNativeCallableInput>;
  readonly erasedPhysicals: ReadonlySet<TargetTypeRef>;
  readonly formalCarrier: (candidate: RustNativeCallableInput, current: TargetTypeRef,
    bindings: SourceStorageBindings, depth: number) => TargetTypeRef | undefined;
  readonly operandFor: (carrier: TargetTypeRef, subject: SourceStorageSubject,
    bindings: SourceStorageBindings, depth: number) => TargetTypeRef | undefined;
  readonly fail: (message: string) => undefined;
}) {
  const { context, genericsFor, valueOwnerFor, selectedInputs, erasedPhysicals, formalCarrier, operandFor, fail } = input;
  return (origin: SourceStorageSubject, bindings: SourceStorageBindings, current: TargetTypeRef,
    depth: number, optional = false, nativeInput?: RustNativeCallableInput): TargetTypeRef | undefined => {
    const fact = context.records.contextualValueConversion.get(origin.node);
    if (origin.projection.length !== 0 || fact?.conversion.kind !== "callable-adapter" ||
      !rustTargetTypeRefEquals(fact.sourceCarrier, rustValueCarrierBeforeContextualConversion(context.records, origin.node)))
      return fail("Native callable conversion storage requires its exact finalized source and destination contract.");
    const generics = genericsFor(valueOwnerFor(origin.node), bindings, depth + 1);
    if (generics.kind === "unresolved") return fail(generics.reason);
    const { types, lifetimes, consts } = generics.bindings;
    const conversion = substituteRustCallableConversion(fact.conversion, types, lifetimes, consts);
    const target = callableValueCarrier(conversion.target);
    if (target === undefined || !rustCallableInvocationSignaturesMatch(current, target))
      return optional ? undefined : fail("Native callable conversion storage conflicts with its selected activation signature.");
    const inputImplementation = nativeInput === undefined ? undefined : formalCarrier(nativeInput, conversion.source, bindings, depth);
    const operand = nativeInput !== undefined
      ? inputImplementation === undefined ? undefined : substituteRustTargetGenerics(inputImplementation, types, lifetimes, consts)
      : operandFor(conversion.source, origin, bindings, depth + 1);
    const physicalInputs = operand === undefined ? [] : [...selectedInputs].filter(candidate =>
      rustTargetTypeRefEquals(candidate.implementation, operand));
    const selectedInput = physicalInputs.length === 1 ? physicalInputs[0] : undefined;
    const selectedCarrier = selectedInput === undefined ? undefined : substituteRustTargetGenerics(selectedInput.carrier,
      types, lifetimes, consts);
    const originalSignature = selectedInput === undefined || selectedCarrier === undefined ||
      !rustCallableInvocationSignaturesMatch(conversion.source, selectedCarrier) ? undefined
      : rustNativeCallableInputPhysicalSignature(selectedInput, []);
    const source: RustNativeCallablePhysicalSource | undefined = operand === undefined ? undefined : physicalInputs.length === 0
      ? rustNativeCallablePhysicalSource(conversion.source,
        { kind: "selected", carrier: operand, inputs: [...selectedInputs], ...(erasedPhysicals.has(operand) ? { erased: true as const } : {}) },
        context.frames)
      : originalSignature === undefined || selectedInput === undefined ? undefined : Object.freeze({ carrier: operand, input: selectedInput,
        signature: Object.freeze({
          parameters: Object.freeze(originalSignature.parameters.map(parameter => substituteRustTargetGenerics(parameter, types, lifetimes, consts))),
          result: substituteRustTargetGenerics(originalSignature.result, types, lifetimes, consts),
          error: substituteRustTargetGenerics(originalSignature.error, types, lifetimes, consts),
        }) });
    const file = context.ast.getSourceFile(origin.node);
    const physical = source === undefined || file === undefined ? undefined
      : rustCallableConversionPhysical(conversion, source.signature, context.ast.getFileName(file),
        conversion.target.kind === "closure" ? rustCallableClosureErrorBoundary(origin.node, context.ast, context.operationAttempts) : undefined,
        context.definitions, source.erased === true)?.carrier;
    return physical ?? fail("Native callable conversion storage has no exact physical adaptation contract.");
  };
}
