import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustCheckedPropertySelectionInput } from "../../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { ExtensionFactSubject } from "@tsonic/tsts";
import { sourceCallableValueExpression } from "@tsonic/target-api/source";
import { asNode, resolveSelectedProviderDeclaration } from "../../../policy/identities/selected-source.js";
import { selectRustProviderExport } from "../../../policy/operations/provider-selection.js";
import { isRustCallableCarrier } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderSourceReceiver } from "../../../target-model/records/operations/finalized-operation.js";

export function selectRustProviderSourceReceiver(
  subject: ExtensionFactSubject,
  carrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustProviderSourceReceiver | undefined {
  const expression = asNode(subject, context);
  if (expression === undefined) return undefined;
  const { ast } = context;
  const parent = ast.parent(expression);
  const access = parent !== undefined && ast.is.IsPropertyAccessExpression(parent)
    ? context.semanticsFor(parent).operations.propertyAccess(parent)
    : parent !== undefined && ast.is.IsElementAccessExpression(parent)
      ? context.semanticsFor(parent).operations.elementAccess(parent)
      : undefined;
  const selectedReceiver = access?.receiver.expression === expression ? access.receiver : undefined;
  const reference = selectedReceiver === undefined
    ? context.source.navigation.sourceReferenceFor(sourceCallableValueExpression(ast, expression, { typeAssertions: "transparent" }))
    : undefined;
  const declaration = selectedReceiver === undefined ? reference?.declaration : selectedReceiver.valueDeclaration;
  const provider = declaration === undefined || !ast.is.IsVariableDeclaration(declaration) ? undefined
    : resolveSelectedProviderDeclaration(context, declaration, [
      { subject: selectedReceiver?.valueSymbol ?? reference?.symbol, precision: "exact" },
    ]);
  if (provider?.kind === "conflict") return undefined;
  const exported = provider?.kind === "selected" && provider.identity.memberId === undefined &&
    provider.identity.signatureId === undefined ? selectRustProviderExport(options.providerExports, provider.identity) : undefined;
  const namespace = exported?.kind === "selected" && exported.row.declarationKind === "namespace" &&
    provider?.kind === "selected" && exported.row.moduleSpecifier === provider.identity.moduleSpecifier;
  if (selectedReceiver?.intrinsic === "global-object" || declaration !== undefined && (
    ast.is.IsClassDeclaration(declaration) || ast.is.IsClassExpression(declaration) ||
    ast.is.IsModuleDeclaration(declaration) || ast.is.IsSourceFile(declaration) || ast.is.IsEnumDeclaration(declaration) ||
    namespace ||
    ast.is.IsVariableDeclaration(declaration) && options.sourceProfiles.profileForNode(declaration, ast) !== undefined &&
      (carrier === undefined || isRustCallableCarrier(carrier))
  )) return Object.freeze({ kind: "compile-time" });
  return carrier === undefined ? undefined : Object.freeze({ kind: "runtime", carrier });
}

export function isIntrinsicSourceQualifier(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): boolean {
  const { ast } = context;
  const declaration = request.sourceSelectedDeclaration;
  if (!options.jsEnabled || request.accessMode !== "read" || request.optionalChain === true ||
    request.sourceReceiverIntrinsic !== "global-object" || declaration === undefined ||
    !ast.is.IsVariableDeclaration(declaration) ||
    options.sourceProfiles.profileForNode(declaration, ast) !== "js") return false;
  if (ast.is.IsElementAccessExpression(request.expression)) {
    const argument = ElementAccessExpression_ArgumentExpression(ast, request.expression);
    if (argument === undefined || (!ast.is.IsStringLiteral(argument) &&
      !ast.is.IsNoSubstitutionTemplateLiteral(argument))) return false;
  }
  let qualifier = request.expression;
  let parent = ast.parent(qualifier);
  while (parent !== undefined && (
    ast.is.IsParenthesizedExpression(parent) || ast.is.IsAsExpression(parent) ||
    ast.is.IsTypeAssertion(parent) || ast.is.IsSatisfiesExpression(parent) ||
    ast.is.IsNonNullExpression(parent))) {
    if (Node_Expression(ast, parent) !== qualifier) return false;
    qualifier = parent;
    parent = ast.parent(parent);
  }
  return parent !== undefined &&
    (ast.is.IsPropertyAccessExpression(parent) || ast.is.IsElementAccessExpression(parent)) &&
    Node_Expression(ast, parent) === qualifier;
}
