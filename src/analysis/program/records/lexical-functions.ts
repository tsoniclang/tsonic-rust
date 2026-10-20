import type { Node } from "@tsonic/tsts";
import type { RustLexicalFunctionEnvironmentSelection, RustLexicalFunctionSelection, RustLexicalFunctionEnvironmentPlan, RustLexicalFunctionQueries } from "../../../target-model/records/lexical-functions.js";

export function sealRustLexicalFunctionEnvironments(
  declarations: readonly Node[], selections: ReadonlyMap<Node, RustLexicalFunctionEnvironmentSelection>,
  scheduled: ReadonlyMap<Node, readonly Node[]>, genericNodes: ReadonlyMap<Node, readonly Node[]>,
  callees: ReadonlyMap<Node, readonly Node[]>,
): RustLexicalFunctionEnvironmentPlan {
  const empty: readonly Node[] = Object.freeze([]);
  return Object.freeze({ declarations: Object.freeze([...declarations]), subjects: Object.freeze([...selections.keys()]),
    forDeclaration: (declaration: Node) => selections.get(declaration),
    valueDeclarationsAt: (statement: Node) => scheduled.get(statement) ?? empty,
    genericNodesFor: (declaration: Node) => genericNodes.get(declaration) ?? empty,
    calleesFor: (declaration: Node) => callees.get(declaration) ?? empty,
  });
}

export function sealRustLexicalFunctionQueries(
  selections: ReadonlyMap<Node, RustLexicalFunctionSelection>,
  valueDeclarationsAt: (statement: Node) => readonly Node[],
): RustLexicalFunctionQueries {
  return Object.freeze({ forDeclaration: (declaration: Node) => selections.get(declaration), valueDeclarationsAt });
}
