import type { Node } from "@tsonic/tsts";
import type { RustSourceCallableValueFact } from "../operations/operation-selections.js";

export interface RustLexicalValueDeclaration {
  readonly declaration: Node;
  readonly name: string;
  readonly value: RustSourceCallableValueFact;
}
