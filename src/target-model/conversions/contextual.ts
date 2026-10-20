import type { RustValueConversion } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";

import { type RustProviderRecordCopy } from "./provider-record.js";
import { type RustEmptyRecordConversion } from "./empty-record.js";

import { type RustGenericCallableConversion } from "./generic-callable.js";
import { type RustIntegerTruncationConversion } from "./integer-truncation.js";

import { type RustCallableConversion } from "./callable.js";

import { type RustProjectUnionMapConversion } from "./project-union.js";

export type RustContextualValueConversion =
  | RustValueConversion
  | RustProviderRecordCopy
  | RustEmptyRecordConversion
  | RustGenericCallableConversion
  | RustIntegerTruncationConversion
  | RustCallableConversion
  | RustProjectUnionMapConversion
  | {
      readonly kind: "native-trait-object-upcast";
      readonly source: TargetTypeRef;
      readonly target: Extract<TargetTypeRef, { readonly kind: "trait-object" }>;
    }
  | {
      readonly kind: "reference-reborrow";
      readonly source: Extract<TargetTypeRef, { readonly kind: "reference" }>;
      readonly target: TargetTypeRef;
    };
