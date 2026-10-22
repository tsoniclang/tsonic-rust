import type { AstReader, Node } from "@tsonic/tsts";
import { VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustCompileTimeSourceProducer } from "../program/records/compile-time-source.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

/** A variable statement whose authored declarations are all compile-time source emits nothing and is compile-time too. */
export function eraseRustCompileTimeVariableStatements(input: {
  readonly ast: AstReader; readonly nodes: readonly Node[]; readonly records: RustProgramRecords;
  readonly producer: RustCompileTimeSourceProducer; readonly required: RustRequiredRecord[];
}): void {
  for (const node of input.nodes) {
    if (!input.ast.is.IsVariableStatement(node) || input.records.compileTimeSource.get(node) !== undefined) continue;
    const declarations = VariableDeclarationList_Declarations(input.ast, VariableStatement_DeclarationList(input.ast, node)) ?? [];
    if (declarations.length === 0 || !declarations.every(declaration =>
      declaration !== undefined && input.records.compileTimeSource.get(declaration) !== undefined)) continue;
    requireRustRecord(input.required, "compileTimeSource", node, input.ast.kindName(node), "eraseRustCompileTimeVariableStatements");
    input.producer.erase(node);
  }
}

/** A node inside compile-time source (memory metadata, value-struct schemas, callable aliases) is never emitted. */
export function rustWithinCompileTimeSource(ast: AstReader, records: Pick<RustProgramRecords, "compileTimeSource">, node: Node): boolean {
  for (let current = ast.parent(node); current !== undefined; current = ast.parent(current)) {
    if (records.compileTimeSource.get(current) !== undefined) return true;
  }
  return false;
}
