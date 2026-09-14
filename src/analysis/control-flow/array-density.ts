import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import type { RustSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveSelectedJsSourceMember } from "../../policy/evidence/selected-source.js";

const densityPreservingMethods = new Set([
  "entries", "keys", "values", "push", "pop", "shift", "unshift",
  "reverse", "sort", "fill", "copyWithin", "splice", "slice", "concat",
  "includes", "indexOf", "lastIndexOf", "join", "toString", "flat",
  "at", "toReversed", "toSorted", "toSpliced", "with",
]);

export function createRustArrayDensityQuery(
  context: RustSourcePolicyContext,
  profiles: RustSourceProfileRegistry,
): (expression: Node) => boolean {
  const { ast } = context;
  const navigation = context.source.navigation;
  const safeDeclarations = new WeakSet<Node>();
  const denseDeclarations = new WeakMap<Node, boolean>();
  const activeDeclarations = new Set<Node>();
  const maximumProofNodes = 16_384;

  const unwrap = (node: Node): Node => {
    let current = node;
    for (;;) {
      const kind = ast.kindName(current);
      if (kind !== "KindParenthesizedExpression" && kind !== "KindAsExpression" &&
        kind !== "KindSatisfiesExpression" && kind !== "KindNonNullExpression") return current;
      const inner = Node_Expression(ast, current);
      if (inner === undefined) return current;
      current = inner;
    }
  };
  const outer = (node: Node): Node => {
    let current = node;
    for (;;) {
      const parent = ast.parent(current);
      if (parent === undefined || unwrap(parent) !== unwrap(current)) return current;
      current = parent;
    }
  };
  const arrayMember = (node: Node): string | undefined => {
    const property = context.semanticsFor(node).operations.propertyAccess(node);
    const identity = property === undefined ? undefined : resolveSelectedJsSourceMember(
      context, property.selectedDeclaration, profiles,
    );
    return identity !== undefined && (identity.ownerName === "Array" || identity.ownerName === "ReadonlyArray")
      ? identity.memberName : undefined;
  };
  const implementation = (call: Node): Node | undefined => {
    if (ast.kindName(call) !== "KindCallExpression" ||
      ast.arguments(call).some(argument => argument === undefined || ast.kindName(argument) === "KindSpreadElement")) return undefined;
    const semantics = context.semanticsFor(call);
    const selected = semantics.operations.call(call);
    const signature = selected === undefined ? undefined : semantics.declarations.signatureDeclaration(selected.selectedSignature);
    if (signature === undefined || !navigation.isProjectDeclaration(signature)) return undefined;
    const target = navigation.callableImplementation(signature);
    if (target?.kind !== "resolved" || ast.kindName(target.implementation.declaration) !== "KindFunctionDeclaration") return undefined;
    const declaration = target.implementation.declaration;
    return ast.parameters(declaration).some(parameter => parameter === undefined ||
      ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined)
      ? undefined : declaration;
  };
  const forwardedParameter = (reference: Node): Node | undefined => {
    const argument = outer(reference);
    const call = ast.parent(argument);
    if (call === undefined) return undefined;
    const selected = implementation(call);
    const index = ast.arguments(call).indexOf(argument);
    return selected === undefined || index < 0 ? undefined : ast.parameters(selected)[index];
  };
  const safe = (declaration: Node): boolean => {
    if (safeDeclarations.has(declaration)) return true;
    const pending = [declaration];
    const visited = new Set<Node>();
    for (let index = 0; index < pending.length; index++) {
      const subject = pending[index]!;
      if (visited.has(subject) || safeDeclarations.has(subject)) continue;
      if (visited.size >= maximumProofNodes) return false;
      visited.add(subject);
      const summary = navigation.declarationUseSummary(subject);
      if (summary.bindingWritten || summary.exported) return false;
      for (const use of summary.uses) {
        if (pending.length >= maximumProofNodes) return false;
        if (use.kind === "type-only") continue;
        const reference = outer(use.reference);
        const parent = ast.parent(reference);
        if (parent === undefined) return false;
        if (ast.kindName(parent) === "KindVariableDeclaration" && Node_Initializer(ast, parent) === reference &&
          ast.kindName(ast.name(parent)) === "KindIdentifier") {
          pending.push(parent);
          continue;
        }
        if (use.role === "argument") {
          const parameter = forwardedParameter(reference);
          if (parameter === undefined) return false;
          pending.push(parameter);
          continue;
        }
        if (ast.kindName(parent) === "KindPropertyAccessExpression" && Node_Expression(ast, parent) === reference) {
          const member = arrayMember(parent);
          if (member === "length" && use.role !== "write") continue;
          const call = ast.parent(parent);
          if (member === undefined || !densityPreservingMethods.has(member) || call === undefined ||
            ast.kindName(call) !== "KindCallExpression" || Node_Expression(ast, call) !== parent) return false;
          continue;
        }
        if (ast.kindName(parent) === "KindElementAccessExpression" && Node_Expression(ast, parent) === reference &&
          use.role !== "write") continue;
        if (use.role === "comparison" || use.role === "condition") continue;
        return false;
      }
    }
    for (const subject of visited) safeDeclarations.add(subject);
    return true;
  };
  const dense = (expression: Node): boolean => {
    const node = unwrap(expression);
    if (ast.kindName(node) === "KindArrayLiteralExpression") {
      return ast.elements(node).every(element => element !== undefined && ast.kindName(element) !== "KindOmittedExpression" &&
        (ast.kindName(element) !== "KindSpreadElement" ||
          (Node_Expression(ast, element) !== undefined && dense(Node_Expression(ast, element)!))));
    }
    if (ast.kindName(node) !== "KindIdentifier") return false;
    const declaration = navigation.sourceReferenceFor(node)?.declaration;
    if (declaration === undefined || activeDeclarations.has(declaration) || activeDeclarations.size >= 256) return false;
    const previous = denseDeclarations.get(declaration);
    if (previous !== undefined) return previous;
    if (!safe(declaration)) return false;
    activeDeclarations.add(declaration);
    let result = false;
    try {
      const initializer = Node_Initializer(ast, declaration);
      if (ast.kindName(declaration) === "KindVariableDeclaration" && initializer !== undefined) result = dense(initializer);
      else if (ast.kindName(declaration) === "KindParameter") {
        const callable = ast.parent(declaration);
        const index = callable === undefined ? -1 : ast.parameters(callable).indexOf(declaration);
        const uses = callable === undefined ? [] : navigation.declarationUses(callable).filter(use => use.kind !== "type-only");
        result = index >= 0 && uses.length > 0 && uses.every(use => {
          const callee = outer(use.reference);
          const call = ast.parent(callee);
          if (use.kind !== "direct-call" || call === undefined || Node_Expression(ast, call) !== callee ||
            implementation(call) !== callable) return false;
          const argument = ast.arguments(call)[index] ?? initializer;
          return argument !== undefined && dense(argument);
        });
      }
    } finally { activeDeclarations.delete(declaration); }
    denseDeclarations.set(declaration, result);
    return result;
  };
  return expression => {
    const seen = new Set<Node>();
    let node = unwrap(expression);
    while (ast.kindName(node) === "KindIdentifier") {
      const declaration = navigation.sourceReferenceFor(node)?.declaration;
      if (declaration === undefined || seen.has(declaration) || seen.size >= maximumProofNodes ||
        navigation.declarationUseSummary(declaration).bindingWritten) return false;
      seen.add(declaration);
      const initializer = Node_Initializer(ast, declaration);
      if (initializer === undefined) return false;
      node = unwrap(initializer);
    }
    if (ast.kindName(node) !== "KindCallExpression" || ast.arguments(node).length !== 0) return false;
    const member = Node_Expression(ast, node);
    if (member === undefined || ast.kindName(member) !== "KindPropertyAccessExpression" || arrayMember(member) !== "entries") return false;
    const receiver = Node_Expression(ast, member);
    return receiver !== undefined && dense(receiver);
  };
}
