import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceDeclarationIsModuleScoped, sourceLexicalCaptures,
  sourceMayReadBeforeInitialization,
  type TargetSourceProgram } from "@tsonic/target-api/source";

export function rustDirectLexicalCallableBinding(
  declaration: Node,
  source: TargetSourceProgram,
): Node | undefined {
  const { ast, navigation } = source;
  if (!ast.is.IsArrowFunction(declaration) || ast.hasModifierKind(declaration, "async")) return undefined;
  const binding = ast.parent(declaration);
  if (binding === undefined || !ast.is.IsVariableDeclaration(binding) ||
    ast.variableDeclarationKind(binding) !== "const" || Node_Initializer(ast, binding) !== declaration ||
    sourceDeclarationIsModuleScoped(binding, ast) || ast.name(binding) === undefined ||
    !ast.is.IsIdentifier(ast.name(binding)!)) return undefined;
  if (navigation.declarationUseSummary(binding).captured ||
    sourceMayReadBeforeInitialization(binding, ast, navigation) ||
    rustSourceDirectCalls(binding, declaration, source) === undefined) return undefined;
  const captures = sourceLexicalCaptures(declaration, [declaration], ast, navigation);
  return captures.receivers.length === 0 ? binding : undefined;
}

export function rustSourceDirectCalls(
  binding: Node,
  implementation: Node,
  source: TargetSourceProgram,
): readonly Node[] | undefined {
  const { ast, navigation } = source;
  const summary = navigation.declarationUseSummary(binding);
  if (summary.bindingWritten || summary.memberWritten || summary.exported || summary.aliasedOrStored ||
    summary.hasUnclassifiedValueUse || summary.directCallCount === 0 || summary.uses.length > 131_072) return undefined;
  const calls: Node[] = [];
  for (const use of summary.uses) {
    if (use.kind === "type-only") continue;
    if (use.kind !== "direct-call" || use.role !== "call-target" || use.throughMember) return undefined;
    let callee = use.reference;
    let call = ast.parent(callee);
    let depth = 0;
    while (call !== undefined && ast.is.IsParenthesizedExpression(call) && Node_Expression(ast, call) === callee) {
      if (++depth > 256) return undefined;
      callee = call;
      call = ast.parent(callee);
    }
    if (call === undefined || !ast.is.IsCallExpression(call) || Node_Expression(ast, call) !== callee) return undefined;
    const semantics = source.semantics.forNode(call);
    const selected = semantics.operations.call(call);
    if (selected === undefined || semantics.declarations.signatureDeclaration(selected.selectedSignature) !== implementation)
      return undefined;
    calls.push(call);
  }
  return Object.freeze(calls);
}
