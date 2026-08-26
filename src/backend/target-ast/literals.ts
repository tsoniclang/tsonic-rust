import { singleRustUnicodeScalar } from "../../target-model/syntax/literals.js";

export function requireRustCharacterScalar(value: string): string {
  const scalar = singleRustUnicodeScalar(value);
  if (scalar === undefined) {
    throw new Error("A Rust character literal must contain exactly one Unicode scalar value.");
  }
  return scalar;
}
