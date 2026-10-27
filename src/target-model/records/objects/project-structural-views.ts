import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectFieldSelection } from "./project-fields.js";
import type { RustProjectAccessorSelection } from "./project-accessors.js";
import type { RustCallableValueAdapter } from "../callables/callable-adapters.js";
import type { RustClassValueCallable } from "../callables/class-value-callables.js";

export interface RustProjectStructuralView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly {
    readonly declaration: Node;
    readonly storageIndex: number;
    readonly field?: RustProjectFieldSelection;
    readonly accessor?: RustProjectAccessorSelection;
    readonly readAdapter?: RustCallableValueAdapter;
    readonly callable?: RustClassValueCallable;
  }[];
}

export interface RustProjectStructuralViewImplementation extends RustProjectStructuralView {
  readonly ownerFileName: string;
}
