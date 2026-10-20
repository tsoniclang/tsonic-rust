import type { Node } from "@tsonic/tsts";
import { VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type TargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceErrorStorageDemandQuery, type SourceErrorRetainedDemand, type SourceErrorStorageDemandQueries, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { resolveRustSourceErrorDeclaration } from "../../policy/types/project/external-project-types.js";
import type { RustSourceProfileRegistry } from "../../policy/types/model/source-profile.js";
import { rustSourceErrorConstructors } from "../../target-model/identities/source-errors.js";
import { resolveSelectedSourceProfileMember } from "../../policy/identities/selected-source.js";

export function createRustErrorStorageDemandQuery(
  source: TargetSourceProgram,
  profiles: RustSourceProfileRegistry,
  storage: SourceStorageQueries,
  retention: (node: Node) => SourceErrorRetainedDemand,
): SourceErrorStorageDemandQueries {
  const { ast } = source;
  const fields = new Set<Node>();
  const constructors = new Set<Node>();
  const stackCaptures = new Set<Node>();
  const context = { ast, source, semanticsFor: (node: Node) => source.semantics.forNode(node) };
  for (const file of source.sourceFiles) {
    for (const statement of ast.statements(file)) {
      if (statement === undefined || profiles.profileForNode(statement, ast) === undefined) continue;
      if (ast.is.IsInterfaceDeclaration(statement)) {
        for (const member of ast.members(statement)) {
          if (member === undefined) continue;
          const identity = resolveSelectedSourceProfileMember(context, member, profiles);
          if (identity === undefined) continue;
          if ((identity.memberName === "constructor" || identity.memberName === "call") &&
            rustSourceErrorConstructors.some(constructor => constructor.ownerName === identity.ownerName)) constructors.add(member);
          if (identity.ownerName === "ErrorConstructor" && identity.memberName === "captureStackTrace") stackCaptures.add(member);
        }
      }
      for (const declaration of VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement)) ?? []) {
        if (declaration === undefined) continue;
        const root = resolveRustSourceErrorDeclaration(declaration, profiles);
        if (root === undefined) continue;
        for (const field of root.fields) fields.add(field.declaration);
        for (const constructor of root.constructorDeclarations) constructors.add(constructor);
      }
    }
  }
  return createSourceErrorStorageDemandQuery(source, { fields: [...fields], constructors: [...constructors],
    stackCaptures: [...stackCaptures], storageMutators: [], retention }, storage);
}
