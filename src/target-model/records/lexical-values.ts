import type { Node } from "@tsonic/tsts";
import type { RustSourceCallableValueFact } from "./operation-selections.js";

export interface RustLexicalValueDeclaration {
  readonly declaration: Node;
  readonly name: string;
  readonly value: RustSourceCallableValueFact;
}
