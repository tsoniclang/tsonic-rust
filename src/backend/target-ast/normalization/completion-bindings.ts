import type { RustBlock, RustStmt } from "../nodes.js";
import { firstAccessesInStatements } from "../inspection/source-dataflow.js";
import { rustBlockReferencesPath, rustStatementReferencesPath } from "../inspection/source-usage.js";

export function closeRustCompletionBindings(block: RustBlock): RustBlock {
  const statements = [...block.statements];
  const moved = new Set<number>();
  const added = new Map<number, number>();
  let remaining = 4_194_304;
  for (const [index, declaration] of statements.entries()) {
    if (declaration.kind !== "let" || declaration.init !== undefined || declaration.type === undefined) continue;
    for (let targetIndex = index + 1; targetIndex < statements.length; targetIndex += 1) {
      if (--remaining < 0) throw new Error("Rust completion binding analysis exceeded its finite work budget.");
      const target = statements[targetIndex]!;
      if (!rustStatementReferencesPath(target, declaration.name)) continue;
      if (target.kind !== "try-scope" || target.terminates ||
        target.finallyClause !== undefined && rustBlockReferencesPath(target.finallyClause.body, declaration.name)) break;
      const selected = (body: RustBlock, terminates: boolean): boolean => {
        if (terminates && !rustBlockReferencesPath(body, declaration.name)) return true;
        const accesses = firstAccessesInStatements(body.statements, declaration.name);
        return accesses.has("write") && !accesses.has("read") && !accesses.has("none");
      };
      if (!selected(target.body, target.bodyTerminates) ||
        target.catchClause !== undefined && !selected(target.catchClause.body, target.catchClause.terminates)) break;
      const bindings = [...target.normalBindings ?? [], declaration];
      statements[targetIndex] = { ...target, normalBindings: bindings };
      added.set(targetIndex, added.get(targetIndex) ?? bindings.length - 1);
      moved.add(index);
      break;
    }
  }
  if (moved.size === 0) return block;
  const result: RustStmt[] = [];
  for (const [index, statement] of statements.entries()) {
    if (moved.has(index)) continue;
    result.push(statement);
    const firstAdded = added.get(index);
    if (statement.kind !== "try-scope" || firstAdded === undefined) continue;
    for (const [bindingIndex, declaration] of (statement.normalBindings ?? []).entries()) {
      if (bindingIndex < firstAdded) continue;
      result.push({ ...declaration, init: { kind: "field",
        receiver: { kind: "path", path: statement.flowName }, name: String(bindingIndex) } });
    }
  }
  return { ...block, statements: result };
}
