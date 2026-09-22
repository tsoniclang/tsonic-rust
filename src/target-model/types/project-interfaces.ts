import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "./model.js";
import type { SourceProjectReference } from "@tsonic/target-api/source";

export interface RustImplicitInterfaceContract {
  readonly source: Node;
  readonly target: Node;
  readonly subject: Node;
  readonly carrier: TargetTypeRef;
  readonly members: readonly {
    readonly declaration: Node;
    readonly implementation: SourceProjectReference;
  }[];
}
