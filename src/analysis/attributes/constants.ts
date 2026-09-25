import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, ObjectLiteralProperty_Value, sourceIntegerLiteralValue } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAttributeArgumentSchema, RustProviderAttributeRow } from "../../providers/packages/attributes.js";
import type { RustAttributeConstant } from "../../target-model/attributes/model.js";
import { mergeProviderDeclarationIdentities } from "../../policy/evidence/selected-source.js";
import { rustProviderOperationOwnerMatches } from "../../policy/operations/provider-selection.js";

export function selectRustAttributeConstant(
  node: Node,
  schema: RustAttributeArgumentSchema,
  row: RustProviderAttributeRow,
  source: TargetSourceProgram,
  active: ReadonlySet<Node> = new Set(),
): RustAttributeConstant | undefined {
  if (active.has(node) || active.size > 128) return undefined;
  const next = new Set(active).add(node);
  const ast = source.ast;
  if (ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) || ast.is.IsSatisfiesExpression(node)) {
    const expression = Node_Expression(ast, node);
    return expression === undefined ? undefined : selectRustAttributeConstant(expression, schema, row, source, next);
  }
  if (ast.is.IsIdentifier(node)) {
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    const initializer = Node_Initializer(ast, declaration);
    return declaration !== undefined && ast.is.IsVariableDeclaration(declaration) && ast.variableDeclarationKind(declaration) === "const" && initializer !== undefined
      ? selectRustAttributeConstant(initializer, schema, row, source, next) : undefined;
  }
  if (schema.kind === "integer") {
    const value = sourceIntegerLiteralValue(ast, node);
    return value === undefined ? undefined : Object.freeze({ kind: "integer", value });
  }
  if (schema.kind === "string") {
    return ast.is.IsStringLiteral(node) || ast.kindName(node) === "KindNoSubstitutionTemplateLiteral"
      ? Object.freeze({ kind: "string", value: ast.text(node) }) : undefined;
  }
  if (schema.kind === "boolean") {
    const kind = ast.kindName(node);
    return kind === "KindTrueKeyword" || kind === "KindFalseKeyword"
      ? Object.freeze({ kind: "boolean", value: kind === "KindTrueKeyword" }) : undefined;
  }
  if (schema.kind === "tuple") {
    if (!ast.is.IsArrayLiteralExpression(node)) return undefined;
    const elements = ast.elements(node);
    if (elements.length !== schema.elements.length) return undefined;
    const values = elements.map((element, index) => element === undefined ? undefined
      : selectRustAttributeConstant(element, schema.elements[index]!, row, source, next));
    return values.every((value): value is RustAttributeConstant => value !== undefined)
      ? Object.freeze({ kind: "tuple", elements: Object.freeze(values) }) : undefined;
  }
  if (schema.kind !== "record" || !ast.is.IsObjectLiteralExpression(node)) return undefined;
  const fields: { readonly name: string; readonly value: RustAttributeConstant }[] = [];
  const selectedMembers = new Set<string>();
  for (const property of ast.properties(node)) {
    if (property === undefined) return undefined;
    const selected = source.semantics.forNode(property).operations.objectLiteralElement(property);
    if (selected?.objectLiteral !== node || (selected.elementKind !== "property" && selected.elementKind !== "shorthand")) return undefined;
    const identities = [selected.sourceSelectedDeclaration, selected.sourceSelectedSymbol, ...selected.sourceSelectedDeclarations]
      .flatMap(subject => {
        const fact = subject === undefined ? undefined : source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
        return fact === undefined ? [] : [fact];
      });
    let identity: ProviderDeclarationIdentity | undefined = identities[0];
    for (const candidate of identities.slice(1)) identity = identity === undefined ? undefined : mergeProviderDeclarationIdentities(identity, candidate);
    if (identity === undefined || !rustProviderOperationOwnerMatches(row, identity) || identity.exportId !== schema.exportId || identity.memberId === undefined || selectedMembers.has(identity.memberId)) return undefined;
    const field = schema.fields.find(candidate => candidate.memberId === identity.memberId);
    const expression = ObjectLiteralProperty_Value(ast, property);
    const value = expression === undefined || field === undefined ? undefined : selectRustAttributeConstant(expression, field.schema, row, source, next);
    if (value === undefined || field === undefined) return undefined;
    selectedMembers.add(identity.memberId);
    fields.push(Object.freeze({ name: field.name, value }));
  }
  if (schema.fields.some(field => !field.optional && !selectedMembers.has(field.memberId))) return undefined;
  return Object.freeze({ kind: "record", fields: Object.freeze(fields) });
}
