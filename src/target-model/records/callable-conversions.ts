import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustCallableConversion } from "../conversions/callable.js";
import type { RustCallablePhysicalSignature, RustCallablePhysicalConversion } from "../conversions/callable-physical.js";
import type { RustNativeCallableInput } from "./native-protocols.js";
import type { RustSourceCallableValueFact } from "./operation-selections.js";

export interface RustNativeCallablePhysicalSource {
  readonly carrier: TargetTypeRef;
  readonly signature: RustCallablePhysicalSignature;
  readonly input?: RustNativeCallableInput;
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
}
