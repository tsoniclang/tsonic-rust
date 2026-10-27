import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { setCarrierFact } from "./project-calls.js";
import type { RustSourceRawAddress } from "../../source/extension/raw-addresses.js";
import { rustSourceRawAddressWidth } from "../../source/extension/raw-addresses.js";
import { rustOptionTargetType, rustRawPointerTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";

import type { RustRawAddressPlan } from "../../target-model/records/storage/raw-addresses.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { readRustSourceRawPointerIdentity } from "../../source/extension/raw-pointers.js";
import { rustPrimitiveTypeName } from "../../target-model/types/carriers/primitives.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";

export function resolveRustRawPointerIdentityCarrier(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile,
  source: NonNullable<ReturnType<typeof readRustSourceRawPointerIdentity>>,
): { readonly carrier?: TargetTypeRef } {
  walk.context.records.assertOpen();
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
    return carrier === undefined ? undefined : Object.freeze({ expression: input, carrier, input: "raw-owner-ref" as const, cast: false });
  });
  if (argumentsPlan.some(argument => argument === undefined)) return {};
  const resultCarrier = rustSourcePrimitiveTargetType(source.operation === "equal-raw-pointer" ? "bool" : "float64");
  requireRustRecord(walk.context.requiredRecords, "rawAddressPlan", expression, source.operation, "resolveRustRawPointerIdentityCarrier");
  walk.context.records.rawAddresses.identity(expression, source.operation === "equal-raw-pointer" ? "same" : "hash",
    resultCarrier, argumentsPlan.filter(argument => argument !== undefined));
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

export function resolveRustRawAddressCarrier(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile, source: RustSourceRawAddress,
): { readonly carrier?: TargetTypeRef } {
  walk.context.records.assertOpen();
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
    if (carrier === undefined) return undefined;
    const literal = walk.context.literalValues.literalValue.get(input.expression);
    const unsuffixed = carrier.kind === "source-primitive" && carrier.name === "int32" && literal?.integer !== undefined &&
      literal.form !== "binary" && rustBorrowValueIsUnprojected(input.expression, walk.context.records);
    const cast = input.input !== "raw-ref" && input.input !== "raw-owner-ref" && !unsuffixed &&
      !(carrier.kind === "source-primitive" && rustPrimitiveTypeName(carrier.name) === input.input);
    return Object.freeze({ expression: input.expression, carrier, input: input.input, cast });
  });
  if (argumentsPlan.some(argument => argument === undefined)) return reject("A raw address operand has no closed Rust value carrier.");
  const resultCarrier = source.operation === "raw-to-address-integer"
    ? rustSourcePrimitiveTargetType(source.addressWidth === 32 ? "uint32" : "uint64") : raw;
  requireRustRecord(walk.context.requiredRecords, "rawAddressPlan", expression, source.operation, "resolveRustRawAddressCarrier");
  walk.context.records.rawAddresses.address(expression, source.operation === "raw-to-address-integer" ? "address"
      : source.operation === "address-integer-to-raw" ? "from_address"
        : source.offsetSignedness === "unsigned" ? "offset_unsigned" : "offset",
    width, resultCarrier, argumentsPlan.filter(argument => argument !== undefined));
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}
