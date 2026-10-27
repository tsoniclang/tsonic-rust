import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustCallableConversion } from "../../conversions/callable.js";
import type { RustCallablePhysicalSignature, RustCallablePhysicalConversion } from "../../conversions/callable-physical.js";
import type { RustNativeCallableInput } from "../native/native-protocols.js";
import type { RustSourceCallableValueFact } from "../operations/operation-selections.js";
import type { RustCallableJoinWrite } from "../native/native-storage.js";

export interface RustNativeCallablePhysicalSource {
  readonly carrier: TargetTypeRef;
  readonly signature: RustCallablePhysicalSignature;
  readonly input?: RustNativeCallableInput;
  /** A type-erased runtime callable: its invocation error is carried through the native error join. */
  readonly erased?: true;
}

export interface RustCallableOperandEmission {
  readonly physical: RustNativeCallablePhysicalSource;
  readonly inline: { readonly kind: "lambda" } | { readonly kind: "named"; readonly value: RustSourceCallableValueFact } | undefined;
}

export interface RustCallableConversionEmission {
  readonly physical: RustCallablePhysicalConversion;
  readonly source: RustNativeCallablePhysicalSource;
  readonly target: "closure" | "input" | "callable";
  readonly invocation: "call" | "invoke";
  readonly fileName: string;
  readonly nested: ReadonlyMap<RustCallablePhysicalConversion, RustCallableConversionEmission>;
}

export interface RustCallableConversionRecords {
  readonly callableOperand: { readonly get: (node: Node, source: TargetTypeRef) => RustCallableOperandEmission | undefined };
  readonly callableContract: { readonly get: (node: Node, conversion: RustCallableConversion) => RustCallableConversionEmission | undefined };
  readonly callableJoinWrite: { readonly get: (node: Node) => RustCallableJoinWrite | undefined };
  /** The physical generic callable family a record interface member stores, keyed by the member declaration. */
  readonly recordFieldStorage: { readonly get: (member: Node) => TargetTypeRef | undefined };
}
