import type { RustNativeDefinitionId } from "./evidence.js";

export type RustNativeArgument =
  | { readonly kind: "type" | "constant"; readonly id: number }
  | { readonly kind: "lifetime"; readonly region: RustNativeRegion };

export type RustNativeBoundIndex = { readonly kind: "bound"; readonly depth: number } | { readonly kind: "canonical" };
export type RustNativeBoundType =
  | { readonly kind: "anonymous" }
  | { readonly kind: "named"; readonly definition: RustNativeDefinitionId };
export type RustNativeBoundRegion =
  | { readonly kind: "anonymous" | "closure-environment" }
  | { readonly kind: "printed"; readonly name: string }
  | { readonly kind: "named"; readonly definition: RustNativeDefinitionId };
export type RustNativeLateRegion =
  | { readonly kind: "anonymous"; readonly index: number }
  | { readonly kind: "printed"; readonly index: number; readonly name: string }
  | { readonly kind: "named"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "closure-environment" };
export type RustNativeVariable =
  | { readonly kind: "type"; readonly declaration: RustNativeBoundType }
  | { readonly kind: "lifetime"; readonly declaration: RustNativeBoundRegion }
  | { readonly kind: "constant" };
export interface RustNativeBinder<Value> {
  readonly variables: readonly RustNativeVariable[];
  readonly value: Value;
}
export type RustNativeRegion =
  | { readonly kind: "early"; readonly index: number; readonly name: string }
  | { readonly kind: "bound"; readonly binder: RustNativeBoundIndex; readonly variable: number; readonly declaration: RustNativeBoundRegion }
  | { readonly kind: "late"; readonly scope: RustNativeDefinitionId; readonly declaration: RustNativeLateRegion }
  | { readonly kind: "static" | "erased" }
  | { readonly kind: "inference"; readonly index: number }
  | { readonly kind: "placeholder"; readonly universe: number; readonly variable: number; readonly declaration: RustNativeBoundRegion };

export type RustNativeAlias =
  | { readonly sort: "type"; readonly category: "projection" | "inherent" | "opaque" | "free";
      readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[] }
  | { readonly sort: "constant"; readonly category: "projection" | "inherent" | "free" | "anonymous";
      readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[] };
export interface RustNativeSignature {
  readonly inputs: readonly number[];
  readonly output: number;
  readonly variadic: boolean;
  readonly unsafeCall: boolean;
  readonly abi: string;
}
export type RustNativeExistential =
  | { readonly kind: "trait"; readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[] }
  | { readonly kind: "projection"; readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[]; readonly term: RustNativeArgument }
  | { readonly kind: "auto-trait"; readonly definition: RustNativeDefinitionId };
export type RustNativeTypePattern =
  | { readonly kind: "range"; readonly start: number; readonly end: number }
  | { readonly kind: "or"; readonly patterns: readonly RustNativeTypePattern[] }
  | { readonly kind: "not-null" };

export type RustNativeType =
  | { readonly kind: "primitive"; readonly name: "bool" | "char" | "str" | "never" |
      "i8" | "i16" | "i32" | "i64" | "i128" | "isize" | "u8" | "u16" | "u32" | "u64" | "u128" | "usize" |
      "f16" | "f32" | "f64" | "f128" }
  | { readonly kind: "adt" | "closure" | "coroutine-closure" | "coroutine" | "coroutine-witness";
      readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[] }
  | { readonly kind: "foreign"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "array"; readonly element: number; readonly length: number }
  | { readonly kind: "pattern"; readonly base: number; readonly pattern: RustNativeTypePattern }
  | { readonly kind: "slice"; readonly element: number }
  | { readonly kind: "raw-pointer"; readonly pointee: number; readonly mutable: boolean }
  | { readonly kind: "reference"; readonly region: RustNativeRegion; readonly pointee: number; readonly mutable: boolean }
  | { readonly kind: "function"; readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[];
      readonly signature: RustNativeBinder<RustNativeSignature> }
  | { readonly kind: "function-pointer"; readonly signature: RustNativeBinder<RustNativeSignature> }
  | { readonly kind: "unsafe-binder"; readonly binder: RustNativeBinder<number> }
  | { readonly kind: "dynamic"; readonly predicates: readonly RustNativeBinder<RustNativeExistential>[]; readonly region: RustNativeRegion }
  | { readonly kind: "tuple"; readonly elements: readonly number[] }
  | { readonly kind: "alias"; readonly alias: RustNativeAlias & { readonly sort: "type" }; readonly rigid: boolean }
  | { readonly kind: "parameter"; readonly index: number; readonly name: string }
  | { readonly kind: "bound"; readonly binder: RustNativeBoundIndex; readonly variable: number; readonly declaration: RustNativeBoundType }
  | { readonly kind: "placeholder"; readonly universe: number; readonly variable: number; readonly declaration: RustNativeBoundType }
  | { readonly kind: "inference"; readonly category: "type" | "integer" | "float" | "fresh-type" | "fresh-integer" | "fresh-float"; readonly index: number };

export type RustNativeConstant =
  | { readonly kind: "parameter"; readonly index: number; readonly name: string }
  | { readonly kind: "bound"; readonly binder: RustNativeBoundIndex; readonly variable: number }
  | { readonly kind: "placeholder"; readonly universe: number; readonly variable: number }
  | { readonly kind: "inference"; readonly category: "constant" | "fresh-constant"; readonly index: number }
  | { readonly kind: "alias"; readonly alias: RustNativeAlias & { readonly sort: "constant" }; readonly rigid: boolean }
  | { readonly kind: "scalar"; readonly type: number; readonly bytes: number; readonly bits: string }
  | { readonly kind: "aggregate"; readonly type: number; readonly fields: readonly number[] }
  | { readonly kind: "expression"; readonly operation: RustNativeConstantOperation; readonly arguments: readonly RustNativeArgument[] };

export const rustNativeConstantOperations = [
  "add", "add-unchecked", "add-with-overflow", "sub", "sub-unchecked", "sub-with-overflow",
  "mul", "mul-unchecked", "mul-with-overflow", "div", "rem", "bit-xor", "bit-and", "bit-or",
  "shl", "shl-unchecked", "shr", "shr-unchecked", "eq", "lt", "le", "ne", "ge", "gt", "cmp", "offset",
  "not", "neg", "pointer-metadata", "call", "as", "use",
] as const;
export type RustNativeConstantOperation = typeof rustNativeConstantOperations[number];

export type RustNativeClause =
  | { readonly kind: "trait"; readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[];
      readonly polarity: "positive" | "negative" }
  | { readonly kind: "region-outlives"; readonly longer: RustNativeRegion; readonly shorter: RustNativeRegion }
  | { readonly kind: "type-outlives"; readonly type: number; readonly region: RustNativeRegion }
  | { readonly kind: "projection"; readonly alias: RustNativeAlias; readonly term: RustNativeArgument }
  | { readonly kind: "constant-type"; readonly constant: number; readonly type: number }
  | { readonly kind: "well-formed"; readonly term: RustNativeArgument }
  | { readonly kind: "constant-evaluatable"; readonly constant: number }
  | { readonly kind: "host-effect"; readonly definition: RustNativeDefinitionId; readonly arguments: readonly RustNativeArgument[];
      readonly constness: "const" | "maybe" }
  | { readonly kind: "unstable-feature"; readonly name: string };

export interface RustNativeGenerics {
  readonly parent: RustNativeDefinitionId | null;
  readonly parentCount: number;
  readonly hasSelf: boolean;
  readonly parameters: readonly RustNativeParameter[];
  readonly predicatesParent: RustNativeDefinitionId | null;
  readonly predicates: readonly RustNativeBinder<RustNativeClause>[];
}
export interface RustNativeParameter {
  readonly definition: RustNativeDefinitionId;
  readonly index: number;
  readonly name: string;
  readonly pureWrtDrop: boolean;
  readonly value:
    | { readonly kind: "lifetime" }
    | { readonly kind: "type"; readonly synthetic: boolean; readonly default: number | null }
    | { readonly kind: "constant"; readonly type: number; readonly default: number | null };
}
