import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression, selectSourceNativeValueGuard, sourceClassFieldIsTypeOnly, VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type SourceDeclarationUse } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { resolveSelectedProviderDeclaration } from "../../policy/identities/selected-source.js";
import { selectedRustProviderGlobal } from "../../policy/identities/provider-globals.js";
import { selectRustProviderSourceReceiver } from "../operations/members/source-qualifiers.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";

export function recordRustTypeOnlyDeclarations(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  walk.context.records.typeOnlyDeclarations.finalize(walk, sourceFiles);
}

export function selectRustTypeOnlyDeclaration(
  walk: RustFactWalk, statement: Node, families: ReadonlySet<Node>,
): "ambient" | "type-family-predicate" | undefined {
  const { ast, source } = walk.context;
  if (ast.is.IsVariableStatement(statement) && ast.hasModifierKind(statement, "ambient")) return "ambient";
  if (!ast.is.IsInterfaceDeclaration(statement) || ast.extendsHeritageElements(statement).length !== 0) return undefined;
  const members = ast.members(statement);
  if (members.length === 0 || members.some(member => member === undefined ||
    ast.kindName(member) !== "KindPropertySignature" ||
    ast.kindName(ast.name(member)) !== "KindComputedPropertyName")) return undefined;
  const belongsToFamily = (node: Node): boolean => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (families.has(current)) return true;
      if (ast.is.IsSourceFile(current)) return false;
    }
    return false;
  };
  const uses = source.navigation.declarationUses(statement);
  return uses.some(use => belongsToFamily(use.reference)) &&
    !uses.some(use => use.kind !== "source-linkage" && !belongsToFamily(use.reference))
    ? "type-family-predicate" : undefined;
}

export function rustAmbientVariableDeclarations(walk: RustFactWalk, statement: Node): readonly Node[] {
  const { ast } = walk.context;
  const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
  if (declarations === undefined || declarations.some(declaration => declaration === undefined)) {
    throw new Error("Ambient declaration analysis received an incomplete checked declaration list.");
  }
  return declarations as readonly Node[];
}

export function checkRustAmbientVariableUses(walk: RustFactWalk, declaration: Node): void {
  for (const use of walk.context.source.navigation.declarationUses(declaration)) {
    checkRustAmbientVariableUse(walk, declaration, use);
  }
}

export function checkRustAmbientVariableUse(walk: RustFactWalk, declaration: Node, use: SourceDeclarationUse): void {
  if (!walk.context.isNativeNode(use.reference) || walk.rejectedExpressions.has(use.reference) ||
    use.kind === "source-linkage" || use.kind === "type-only") return;
  const { ast } = walk.context;
  for (let current: Node | undefined = use.reference; current !== undefined; current = ast.parent(current)) {
    if (ast.kindName(current) === "KindPropertySignature" || sourceClassFieldIsTypeOnly(ast, current)) return;
    if (ast.is.IsSourceFile(current)) break;
  }
  let qualifier = use.reference;
  let parent = ast.parent(qualifier);
  while (parent !== undefined && ["KindParenthesizedExpression", "KindSatisfiesExpression", "KindNonNullExpression"].includes(ast.kindName(parent))) {
    if (Node_Expression(ast, parent) !== qualifier) break;
    qualifier = parent;
    parent = ast.parent(qualifier);
  }
  const nativeGuard = parent === undefined || ast.kindName(parent) !== "KindBinaryExpression" ? undefined
    : selectSourceNativeValueGuard({ ast, navigation: walk.context.source.navigation,
      semanticsFor: walk.context.semanticsFor }, parent);
  if (nativeGuard?.kind === "nominal" && nativeGuard.sourceConstructor === use.reference &&
    nativeGuard.declaration === declaration &&
    walk.context.sourceProfiles.profileForNode(declaration, ast) !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "compileTimeSource", qualifier,
      "native-type-qualifier", "checkRustAmbientVariableUse");
    walk.context.records.compileTimeSources.erase(qualifier);
    return;
  }
  const reference = walk.context.source.navigation.sourceReferenceFor(use.reference);
  const subject = reference?.declaration === declaration ? reference.symbol ?? declaration : declaration;
  const provider = resolveSelectedProviderDeclaration(walk.context, subject,
    [{ subject: declaration, precision: "exact" }, { subject: use.reference, precision: "exact" }]);
  if (provider.kind !== "missing" || selectedRustProviderGlobal(declaration, walk.context,
    walk.operationOptions.providerExports) !== undefined) return;
  if (use.throughMember && selectRustProviderSourceReceiver(use.reference, undefined,
    rustOperationContext(walk, use.reference), walk.operationOptions)?.kind === "compile-time") return;
  appendRustDiagnostic(walk, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING",
    "A runtime read of an authored ambient variable requires an exact native implementation.", use.reference,
    ["target.capability=rust.ambient-value.implementation"]);
}
