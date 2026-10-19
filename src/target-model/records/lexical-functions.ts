import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustBindingStorageFact } from "./operation-selections.js";
import type { RustSourceGenericParameterContract } from "../lifetimes/index.js";

export interface RustLexicalCaptureEmission {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
  readonly carrier: TargetTypeRef;
  readonly physicalCarrier: TargetTypeRef;
  readonly storage: RustBindingStorageFact | undefined;
  readonly owned: boolean;
  readonly borrowedCarrier: TargetTypeRef | undefined;
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustLexicalFunctionEmission {
  readonly captures: readonly RustLexicalCaptureEmission[];
  readonly genericParameters: readonly RustSourceGenericParameterContract[];
}
