import type { Node } from "@tsonic/tsts";

export interface RustSourceLexicalCallableQueries {
  bindingFor(declaration: Node): Node | undefined;
  callsFor(binding: Node, implementation: Node): readonly Node[] | undefined;
}

export interface RustSourceCallableQueries {
  directLexicalBinding(declaration: Node): Node | undefined;
  borrowedReturnParameter(declaration: Node): Node | undefined;
}
