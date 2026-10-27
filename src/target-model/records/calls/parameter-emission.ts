import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustBindingStorageFact } from "../operations/operation-selections.js";

export type RustCallableParameterInitialization =
  | { readonly kind: "binding" }
  | { readonly kind: "return"; readonly expression: Node; readonly carrier: TargetTypeRef };

export interface RustCallableParameterEmission {
  readonly carrier: TargetTypeRef;
  readonly name: string | undefined;
  readonly pattern: Node | undefined;
  readonly sourceCarrier: TargetTypeRef | undefined;
  readonly storage: RustBindingStorageFact | undefined;
  readonly mutable: boolean;
  readonly parameterMutable: boolean;
  readonly initialization: RustCallableParameterInitialization;
  readonly default: { readonly initializer: Node; readonly valueCarrier: TargetTypeRef; readonly retainStorage: boolean } | undefined;
}
