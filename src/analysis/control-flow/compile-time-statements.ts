import type { AstReader, Node } from "@tsonic/tsts";
import { VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustCompileTimeSourceProducer } from "../program/records/program/compile-time-source.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

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

/**
 * A node outside native code: it lies inside compile-time source (a safety builder such as
 * `safety<T>().property(value => value.field)`, or erased memory metadata and its field selectors) or inside a root the
 * analysis proved unreachable. Such a node selects declarations and contracts or is never executed; it is never planned.
 */
export function rustNodeIsOutsideNativeCode(
  ast: AstReader,
  records: Pick<RustProgramRecords, "compileTimeSource" | "nativeUnreachable">,
  safetyOperation: (expression: Node) => { readonly kind: string } | undefined,
  node: Node,
): boolean {
  for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current))
    if (records.compileTimeSource.get(current) !== undefined || records.nativeUnreachable.get(current) === true ||
      safetyOperation(current)?.kind === "safety-builder") return true;
  return false;
}

/** rustNodeIsOutsideNativeCode over an analysis program's syntax reader, records and safety applications. */
export function rustProgramNodeIsOutsideNativeCode(
  program: {
    readonly source: { readonly ast: AstReader };
    readonly records: Pick<RustProgramRecords, "compileTimeSource" | "nativeUnreachable">;
    readonly safetyApplications: { operationForExpression(expression: Node): { readonly kind: string } | undefined };
  },
  node: Node,
): boolean {
  return rustNodeIsOutsideNativeCode(program.source.ast, program.records,
    expression => program.safetyApplications.operationForExpression(expression), node);
}
