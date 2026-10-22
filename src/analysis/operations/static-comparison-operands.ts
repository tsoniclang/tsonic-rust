import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

/**
 * Reading a binding has no observable effect, whether the read copies, clones or moves it. A comparison whose result
 * is decided statically (`constant-equality`, for example `text !== undefined` on a `string`) therefore does not
 * evaluate an operand that only reads a binding, and that read is not a native use of the binding.
 */
export function rustBindingReadIsUnevaluated(ast: AstReader, records: RustProgramRecords, node: Node): boolean {
  return ast.is.IsIdentifier(node) && records.sourceBinding.get(node) !== undefined;
}

/** The binding-read operand of a statically decided comparison: binary emission skips it, so liveness does too. */
export function rustStaticComparisonSkipsOperand(ast: AstReader, records: RustProgramRecords, node: Node): boolean {
  const parent = ast.parent(node);
  return parent !== undefined && records.targetOperation.get(parent)?.kind === "constant-equality" &&
    (BinaryExpression_Left(ast, parent) === node || BinaryExpression_Right(ast, parent) === node) &&
    rustBindingReadIsUnevaluated(ast, records, node);
}
