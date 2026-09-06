import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { setCarrierFact } from "./project-calls.js";
import type { RustSourceRawAddress } from "../../policy/operations/raw-address-source.js";
import { rustSourceRawAddressWidth } from "../../policy/operations/raw-address-source.js";
import { rustOptionTargetType, rustRawPointerTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustRawAddressPlanKey } from "../../target-model/operations/raw-addresses.js";
import type { RustRawAddressPlan } from "../../target-model/operations/raw-addresses.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { readRustSourceRawPointerIdentity } from "../../policy/operations/raw-pointer-source.js";

export function resolveRustRawPointerIdentityCarrier(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile,
  source: NonNullable<ReturnType<typeof readRustSourceRawPointerIdentity>>,
): { readonly carrier?: TargetTypeRef } {
  const inputs = source.operation === "equal-raw-pointer"
    ? [source.leftExpression, source.rightExpression] : [source.pointerExpression];
  const arguments_ = walk.context.ast.arguments(expression);
  if (source.call !== expression || arguments_.length !== inputs.length ||
    inputs.some((input, index) => input !== arguments_[index])) {
    appendRustDiagnostic(walk, "RUST_RAW_POINTER_IDENTITY_EVIDENCE_CONFLICT",
      "Raw pointer identity requires the exact selected source operands.", expression, []);
    return {};
  }
  const expected = rustOptionTargetType(rustRawPointerTargetType());
  const argumentsPlan = inputs.map(input => {
    const carrier = resolveExpressionCarrier(walk, input, sourceFile, expected);
    return carrier === undefined ? undefined : Object.freeze({ expression: input, carrier, input: "raw-owner-ref" as const });
  });
  if (argumentsPlan.some(argument => argument === undefined)) return {};
  const resultCarrier = rustSourcePrimitiveTargetType(source.operation === "equal-raw-pointer" ? "bool" : "float64");
  walk.context.facts.set(expression, rustRawAddressPlanKey, Object.freeze({
    method: source.operation === "equal-raw-pointer" ? "same" : "hash", resultCarrier,
    arguments: Object.freeze(argumentsPlan.filter(argument => argument !== undefined)),
  }), [{ message: "Rust exact raw address identity and optional carriers" }]);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

export function resolveRustRawAddressCarrier(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile, source: RustSourceRawAddress,
): { readonly carrier?: TargetTypeRef } {
  const reject = (message: string): { readonly carrier?: TargetTypeRef } => {
    appendRustDiagnostic(walk, "RUST_RAW_ADDRESS_CONTRACT_NOT_PROVEN", message, expression,
      ["target.capability=rust.raw-address.exact-integer"]);
    return {};
  };
  const raw = rustOptionTargetType(rustRawPointerTargetType());
  const inputs: { expression: Node; expected: TargetTypeRef; input: RustRawAddressPlan["arguments"][number]["input"] }[] = [];
  if (source.operation === "address-integer-to-raw") {
    inputs.push({ expression: source.addressExpression,
      expected: rustSourcePrimitiveTargetType(source.addressWidth === 32 ? "uint32" : "uint64"), input: "u64" });
  } else {
    inputs.push({ expression: source.rawExpression, expected: raw, input: "raw-ref" });
    if (source.operation === "byte-offset") {
      const signed = source.offsetSignedness === "signed";
      const primitive = `${signed ? "int" : "uint"}${source.offsetWidth}` as
        "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "int128" | "uint128";
      inputs.push({ expression: source.offsetExpression, expected: rustSourcePrimitiveTargetType(primitive),
        input: signed ? "i128" : "u128" });
    }
  }
  const arguments_ = walk.context.ast.arguments(expression);
  const width = rustSourceRawAddressWidth(walk.context.source.sourceFacts, source);
  if (source.call !== expression || width === undefined || arguments_.length !== inputs.length + 1 ||
    arguments_[arguments_.length - 1] !== source.dataLayoutExpression || inputs.some((input, index) => arguments_[index] !== input.expression)) {
    return reject("Raw address arithmetic requires exact operand bindings and the finalized registered address ABI.");
  }
  const argumentsPlan = inputs.map(input => {
    const carrier = resolveExpressionCarrier(walk, input.expression, sourceFile, input.expected);
    return carrier === undefined ? undefined : Object.freeze({ expression: input.expression, carrier, input: input.input });
  });
  if (argumentsPlan.some(argument => argument === undefined)) return reject("A raw address operand has no closed Rust value carrier.");
  const resultCarrier = source.operation === "raw-to-address-integer"
    ? rustSourcePrimitiveTargetType(source.addressWidth === 32 ? "uint32" : "uint64") : raw;
  walk.context.facts.set(expression, rustRawAddressPlanKey, Object.freeze({
    method: source.operation === "raw-to-address-integer" ? "address"
      : source.operation === "address-integer-to-raw" ? "from_address"
        : source.offsetSignedness === "unsigned" ? "offset_unsigned" : "offset",
    width, resultCarrier, arguments: Object.freeze(argumentsPlan.filter(argument => argument !== undefined)),
  }), [{ message: "Rust exact registered address ABI and integer operands" }]);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}
