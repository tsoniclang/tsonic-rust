import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustBindingStorageFact } from "./operation-selections.js";

export interface RustCallableParameterEmission {
  readonly carrier: TargetTypeRef;
  readonly name: string | undefined;
  readonly pattern: Node | undefined;
  readonly sourceCarrier: TargetTypeRef | undefined;
  readonly storage: RustBindingStorageFact | undefined;
  readonly mutable: boolean;
  readonly parameterMutable: boolean;
  readonly default: { readonly initializer: Node; readonly valueCarrier: TargetTypeRef; readonly retainStorage: boolean } | undefined;
}
