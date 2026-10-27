import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustProjectMethodDispatchVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly virtualSlot: string;
  readonly exactSlot: string;
}
