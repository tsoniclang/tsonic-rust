import { type Node } from "@tsonic/tsts";
import { type RustLexicalFunctionEnvironmentSelection, type RustLexicalFunctionSelection, type RustLexicalFunctionEnvironmentPlan, type RustLexicalFunctionQueries, type RustLexicalFunctionEmission } from "../../../../target-model/records/callables/lexical-functions.js";
import { type RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

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
  calleesFor: (declaration: Node) => readonly Node[],
): RustLexicalFunctionQueries {
  return Object.freeze({ forDeclaration: (declaration: Node) => selections.get(declaration), valueDeclarationsAt, calleesFor });
}

export interface RustLexicalFunctionProducer {
  readonly records: RustRecordFamily<RustLexicalFunctionEmission>;
  declaration(subject: Node, value: RustLexicalFunctionEmission): void;
}

export function createRustLexicalFunctionProducer(assertOpen: () => void): RustLexicalFunctionProducer {
  const family = createRustRecordFamily<RustLexicalFunctionEmission>({ id: "tsonic.rust.lexicalFunction", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    declaration: (subject: Node, value: RustLexicalFunctionEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
