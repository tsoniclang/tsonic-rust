import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Initializer, type SourceProgramNavigation, type SourceProgramSemantics } from "@tsonic/target-api/source";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "./type-policy.js";
import { rustProjectObjectLayout } from "./object-layout.js";

export interface RustReceiverFieldAlias {
  readonly declaration: Node;
  readonly initializer: Node;
  readonly owner: RustProjectTypeDefinition;
}

export interface RustReceiverFieldAliasQueries {
  readonly aliases: readonly RustReceiverFieldAlias[];
  aliasFor(declaration: Node): RustReceiverFieldAlias | undefined;
}

export function analyzeRustReceiverFieldAliases(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly semantics: SourceProgramSemantics;
  readonly projectTypes: RustProjectTypePolicy;
}): RustReceiverFieldAliasQueries {
  const aliases: RustReceiverFieldAlias[] = [];
  for (const owner of input.projectTypes.definitions) {
    if (owner.kind !== "class") continue;
    for (const field of rustProjectObjectLayout(owner.declaration, input.ast)?.fields ?? []) {
      const initializer = Node_Initializer(input.ast, field.declaration);
      if (initializer === undefined || !input.ast.hasModifierKind(field.declaration, "readonly") ||
        input.ast.questionToken(field.declaration) !== undefined ||
        input.ast.kindName(initializer) !== "KindThisExpression" &&
        input.ast.kindName(initializer) !== "KindThisKeyword") continue;
      const uses = input.navigation.declarationUseSummary(field.declaration);
      if (uses.uses.some(use => use.role === "write") ||
        (input.projectTypes.contractsForClass(owner) ?? []).some(contract =>
          (rustProjectObjectLayout(contract.declaration, input.ast)?.fields ?? []).some(candidate => {
            const implementation = input.projectTypes.memberImplementation(owner, candidate.declaration);
            return implementation.kind === "resolved" &&
              implementation.implementation.declaration === field.declaration &&
              (!input.ast.hasModifierKind(candidate.declaration, "readonly") ||
                input.navigation.declarationUseSummary(candidate.declaration).uses.some(use =>
                  use.role === "write"));
          }))) continue;
      const semantics = input.semantics.forNode(field.declaration);
      const receiver = semantics.types.expressionType(initializer);
      const declared = semantics.declarations.declaredValueType(field.declaration);
      const ownerType = semantics.declarations.declaredType(owner.declaration);
      const receiverSymbol = receiver === undefined ? undefined
        : semantics.declarations.typeSymbol(semantics.types.apparentType(receiver) ?? receiver);
      if (receiver === undefined || declared === undefined || ownerType === undefined ||
        receiverSymbol === undefined || receiverSymbol !== semantics.declarations.typeSymbol(ownerType)) continue;
      const symbol = semantics.declarations.typeSymbol(semantics.types.apparentType(declared) ?? declared);
      const candidates = symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol)
        .map(declaration => input.projectTypes.definitionForDeclaration(declaration))
        .filter((definition): definition is RustProjectTypeDefinition => definition !== undefined);
      if (candidates.length !== 1 ||
        input.projectTypes.relationship(input.projectTypes.openCarrier(owner), candidates[0]!).kind !== "related") continue;
      aliases.push(Object.freeze({ declaration: field.declaration, initializer, owner }));
    }
  }
  const byDeclaration = new Map(aliases.map(alias => [alias.declaration, alias] as const));
  return Object.freeze({ aliases: Object.freeze(aliases), aliasFor: (declaration: Node) => byDeclaration.get(declaration) });
}
