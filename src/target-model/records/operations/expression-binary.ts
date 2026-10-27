import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustBinaryOperator } from "../../syntax/tokens.js";

export interface RustBinaryEmission {
  readonly fact: RustTargetOperationFact;
  readonly left: Node;
  readonly right: Node;
  readonly leftUnit: boolean;
  readonly rightUnit: boolean;
  readonly leftNever: boolean;
  readonly leftShared: boolean;
  readonly rightShared: boolean;
  readonly int32Remainder: boolean;
  readonly compound: boolean;
  readonly operator: RustBinaryOperator | undefined;
  readonly leftLiteral: string | undefined;
  readonly rightLiteral: string | undefined;
  readonly selectionTest: boolean;
  readonly constantLeftEffect: boolean;
  readonly constantRightEffect: boolean;
  readonly concatParts: readonly Node[] | undefined;
  readonly optionCheck: { readonly custom: boolean; readonly skipNullish: boolean; readonly nullishUnit: boolean } | undefined;
}
