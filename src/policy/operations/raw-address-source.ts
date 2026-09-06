import type { Node, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { readTsonicDataLayout, readTsonicRawMemoryOperation } from "@tsonic/source-core/facts";
import type { TsonicRawMemoryOperationFact } from "@tsonic/source-core/facts";

export type RustSourceRawAddress = Extract<TsonicRawMemoryOperationFact,
  { readonly operation: "byte-offset" | "raw-to-address-integer" | "address-integer-to-raw" }>;

export function readRustSourceRawAddress(facts: ReadonlySourceFactResolver, expression: Node): RustSourceRawAddress | undefined {
  const fact = readTsonicRawMemoryOperation(facts, expression);
  return fact?.operation === "byte-offset" || fact?.operation === "raw-to-address-integer" ||
    fact?.operation === "address-integer-to-raw" ? fact : undefined;
}

export function rustSourceRawAddressWidth(facts: ReadonlySourceFactResolver, operation: RustSourceRawAddress): 32 | 64 | undefined {
  const abi = readTsonicDataLayout(facts, operation.dataLayoutExpression);
  return abi === undefined || operation.operation !== "byte-offset" && operation.addressWidth !== abi.addressWidth
    ? undefined : abi.addressWidth;
}
