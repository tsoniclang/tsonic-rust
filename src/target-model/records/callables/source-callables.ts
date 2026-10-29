import type { Node } from "@tsonic/tsts";

export interface RustSourceLexicalCallableQueries {
  bindingFor(declaration: Node): Node | undefined;
  callsFor(binding: Node, implementation: Node): readonly Node[] | undefined;
}

export interface RustSourceCallableQueries {
  directLexicalBinding(declaration: Node): Node | undefined;
  borrowedReturn(declaration: Node): RustSourceReturnBorrow | undefined;
  /** The async function whose every call through this `const` binding is a native Promise edge. */
  promiseCallAliasTarget(binding: Node): Node | undefined;
}

export interface RustSourceReturnBorrow {
  readonly parameter: Node;
  readonly returns: readonly Node[];
}
