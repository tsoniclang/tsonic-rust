import type { Node } from "@tsonic/tsts";
import { Node_Expression, BinaryExpression_Left, BinaryExpression_Right, ConditionalExpression_Condition,
  ConditionalExpression_WhenTrue, ConditionalExpression_WhenFalse, TryStatement_TryBlock, TryStatement_CatchClause,
  CatchClause_Block, TryStatement_FinallyBlock } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCompletionBindingProducer } from "../program/records/completion-bindings.js";
import type { RustCompletionBinding } from "../../target-model/records/completion-bindings.js";

type Access = "read" | "write" | "none" | "exit";

export function analyzeRustCompletionBindings(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  producer: RustCompletionBindingProducer): void {
  const { ast } = program.source;
  const selected = new Map<Node, RustCompletionBinding[]>();
  const moved = new Set<Node>();
  for (const scope of new Set(nodes)) {
    if (!ast.is.IsBlock(scope) && !ast.is.IsSourceFile(scope)) continue;
    const statements = ast.statements(scope).filter((node): node is Node => node !== undefined);
    for (const [index, statement] of statements.entries()) for (const declaration of program.records.variableDeclarations.get(statement) ?? []) {
      const binding = program.records.localBinding.get(declaration);
      if (moved.has(declaration) || binding?.kind !== "value" || binding.initializer !== undefined || binding.absenceInitializer || binding.storage !== undefined ||
        program.records.nativeArrayStorage.get(declaration) !== undefined) continue;
      const cache = new Map<Node, ReadonlySet<Access>>();
      const sequence = (values: readonly (Node | undefined)[]): ReadonlySet<Access> => {
        const result = new Set<Access>();
        let open = true;
        for (const value of values) {
          if (!open || value === undefined) continue;
          const accesses = first(value);
          open = accesses.has("none");
          for (const access of accesses) if (access !== "none") result.add(access);
        }
        if (open) result.add("none");
        return result;
      };
      const branches = (condition: Node | undefined, yes: Node | undefined, no: Node | undefined): ReadonlySet<Access> => {
        const result = new Set(condition === undefined ? ["none" as const] : first(condition));
        if (!result.delete("none")) return result;
        const guard = condition === undefined ? undefined : program.records.nativeGuardResult.get(condition);
        for (const branch of guard === undefined ? [yes, no] : [guard ? yes : no])
          for (const access of branch === undefined ? ["none" as const] : first(branch)) result.add(access);
        return result;
      };
      const first = (node: Node): ReadonlySet<Access> => {
        const previous = cache.get(node);
        if (previous !== undefined) return previous;
        let result: ReadonlySet<Access>;
        if (program.records.nativeUnreachable.get(node) === true || program.records.compileTimeSource.get(node) !== undefined) result = new Set(["none"]);
        else if (ast.is.IsIdentifier(node) && program.records.sourceBinding.get(node)?.sourceDeclaration === declaration) result = new Set(["read"]);
        else if (ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node))
          result = new Set([program.records.closureCapture.get(node)?.captures.some(capture => capture.declaration === declaration) ? "read" : "none"]);
        else if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindEqualsToken") {
          const left = BinaryExpression_Left(ast, node);
          const right = BinaryExpression_Right(ast, node);
          if (left !== undefined && ast.is.IsIdentifier(left) && program.records.sourceBinding.get(left)?.sourceDeclaration === declaration) {
            const accesses = new Set(right === undefined ? ["none" as const] : first(right));
            if (accesses.delete("none")) accesses.add("write");
            result = accesses;
          } else result = sequence([left, right]);
        } else if (ast.is.IsIfStatement(node)) {
          const value = ast.as.AsIfStatement(node);
          result = branches(value?.Expression, value?.ThenStatement, value?.ElseStatement);
        } else if (ast.is.IsConditionalExpression(node)) result = branches(ConditionalExpression_Condition(ast, node), ConditionalExpression_WhenTrue(ast, node), ConditionalExpression_WhenFalse(ast, node));
        else if (ast.is.IsBlock(node) || ast.is.IsSourceFile(node)) result = sequence(ast.statements(node));
        else if (ast.is.IsReturnStatement(node) || ast.is.IsThrowStatement(node)) {
          const accesses = new Set(sequence([Node_Expression(ast, node)]));
          if (accesses.delete("none")) accesses.add("exit");
          result = accesses;
        } else if (ast.is.IsWhileStatement(node) || ast.is.IsForStatement(node) || ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node) || ast.is.IsDoStatement(node) || ast.is.IsSwitchStatement(node) || ast.is.IsTryStatement(node)) {
          const accesses = new Set(sequence(ast.children(node)));
          accesses.add("none");
          result = accesses;
        } else result = sequence(ast.children(node));
        if (program.records.statementExit.get(node) === true && result.has("none")) {
          const terminal = new Set(result); terminal.delete("none"); terminal.add("exit"); result = terminal;
        }
        cache.set(node, result);
        return result;
      };
      for (const target of statements.slice(index + 1)) {
        const access = first(target);
        if (!access.has("read") && !access.has("write")) {
          if (!access.has("none")) break;
          continue;
        }
        if (!ast.is.IsTryStatement(target) || program.records.statementExit.get(target) === true) break;
        const body = TryStatement_TryBlock(ast, target);
        const caught = CatchClause_Block(ast, TryStatement_CatchClause(ast, target));
        const finalized = TryStatement_FinallyBlock(ast, target);
        const used = (node: Node | undefined): boolean => node !== undefined && (first(node).has("read") || first(node).has("write"));
        const admitted = (node: Node | undefined): boolean => node === undefined || !first(node).has("read") && !first(node).has("none");
        if (used(finalized) || body === undefined || !admitted(body) || !admitted(caught)) break;
        const values = selected.get(target) ?? [];
        values.push(Object.freeze({ declaration, body: used(body), catch: used(caught) }));
        selected.set(target, values); moved.add(declaration);
        break;
      }
    }
  }
  for (const [node, values] of selected) producer.publish(node, Object.freeze(values));
}
