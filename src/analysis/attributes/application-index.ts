import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, SourceFile, ProviderDeclarationIdentity } from "@tsonic/tsts";
import { tsonicAttributeBuilderFactKey } from "@tsonic/source-core/facts";
import type { TsonicAttributeApplicationFact } from "@tsonic/source-core/facts";
import { isAstNode } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProviderSemantics } from "../../providers/packages/model.js";
import type { RustAttributePlacement, RustProviderAttributeRow } from "../../target-model/attributes/schema.js";
import type { RustAttributeConstant } from "../../target-model/attributes/model.js";
import { mergeProviderDeclarationIdentities } from "../../policy/evidence/selected-source.js";
import { rustProviderOperationOwnerMatches } from "../../policy/operations/provider-selection.js";
import { selectRustAttributeConstant } from "./constants.js";

export interface RustAttributeApplication {
  readonly sourceSubject: Node;
  readonly sourceFile: SourceFile;
  readonly targetDeclaration: Node;
  readonly placement: RustAttributePlacement;
  readonly provider: RustProviderAttributeRow;
  readonly arguments: readonly RustAttributeConstant[];
}

export interface RustAttributeApplicationFactIndex {
  readonly all: readonly RustAttributeApplication[];
  readonly diagnostics: readonly TargetDiagnostic[];
  forDeclaration(declaration: Node): readonly RustAttributeApplication[];
  isCompileTimeExpression(node: Node): boolean;
  isCompileTimeReference(reference: Node): boolean;
}

export function createRustAttributeApplicationFactIndex(
  source: TargetSourceProgram,
  providers: RustProviderSemantics,
): RustAttributeApplicationFactIndex {
  const all: RustAttributeApplication[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  const expressions = new Set<Node>();
  const byDeclaration = new Map<Node, RustAttributeApplication[]>();
  const ast = source.ast;
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_ATTRIBUTE_CONTRACT_NOT_PROVEN", category: "error", source: "tsonic-rust", sourceNode: node, message });
  };
  const visit = (node: Node, sourceFile: SourceFile): void => {
    const fact = source.sourceFacts.getFact(node, tsonicAttributeBuilderFactKey);
    if (fact !== undefined) expressions.add(node);
    if (fact?.kind === "application") {
      const selected = selectApplication(node, sourceFile, fact);
      if (selected !== undefined) {
        all.push(selected);
        const entries = byDeclaration.get(selected.targetDeclaration) ?? [];
        entries.push(selected);
        byDeclaration.set(selected.targetDeclaration, entries);
      }
      return;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child, sourceFile); });
  };
  for (const file of source.sourceFiles) if (file !== undefined && !ast.isDeclarationFile(file)) visit(file, file);
  for (const application of all) {
    const required = application.provider.requiredParent;
    if (required !== undefined && !all.some(parent => parent.targetDeclaration === application.sourceFile &&
      parent.provider.providerId === application.provider.providerId && parent.provider.providerVersion === application.provider.providerVersion &&
      parent.provider.exportId === required.exportId && parent.provider.signatureId === required.signatureId)) {
      reject(application.sourceSubject, "The selected helper attribute requires its exact enclosing module attribute.");
    }
  }
  const frozenByDeclaration = new Map([...byDeclaration].map(([node, applications]) => [node, Object.freeze(applications)]));
  return Object.freeze({ all: Object.freeze(all), diagnostics: Object.freeze(diagnostics),
    forDeclaration: (node: Node) => frozenByDeclaration.get(node) ?? emptyApplications,
    isCompileTimeExpression: (node: Node) => expressions.has(node),
    isCompileTimeReference(reference: Node) {
      for (let current: Node | undefined = reference; current !== undefined; current = ast.parent(current)) if (expressions.has(current)) return true;
      return false;
    },
  });

  function selectApplication(node: Node, sourceFile: SourceFile, fact: TsonicAttributeApplicationFact): RustAttributeApplication | undefined {
    const invocation = isAstNode(ast, fact.invocation) ? fact.invocation : undefined;
    const call = invocation === undefined || !ast.is.IsCallExpression(invocation) ? undefined : source.semantics.forNode(invocation).operations.call(invocation);
    if (call?.outcome !== "applicable" || invocation === undefined) {
      reject(node, "A Rust attribute requires an inline lambda calling its exact checked provider facade."); return undefined;
    }
    const declaration = source.semantics.forNode(invocation).declarations.signatureDeclaration(call.selectedSignature);
    const identities = [call.selectedSignature, declaration].flatMap(subject => {
      const identity = subject === undefined ? undefined : source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
      return identity === undefined ? [] : [identity];
    });
    let identity: ProviderDeclarationIdentity | undefined = identities[0];
    for (const candidate of identities.slice(1)) identity = identity === undefined ? undefined : mergeProviderDeclarationIdentities(identity, candidate);
    const rows = identity === undefined ? [] : providers.attributes.filter(row => rustProviderOperationOwnerMatches(row, identity!) &&
      row.exportId === identity!.exportId && identity!.memberId === undefined && row.signatureId === identity!.signatureId);
    if (rows.length !== 1) { reject(node, "The selected attribute signature has no unique exact native attribute contract."); return undefined; }
    const row = rows[0]!;
    const target = selectedTarget(fact, sourceFile);
    const kind = target === undefined ? undefined : ast.kindName(target);
    const placement: RustAttributePlacement | undefined = target === sourceFile ? "module"
      : kind === "KindFunctionDeclaration" ? "function" : kind === "KindClassDeclaration" ? "struct" : kind === "KindEnumDeclaration" ? "enum" : undefined;
    if (target === undefined || placement === undefined || !row.placements.includes(placement) ||
      fact.selectedMember !== undefined || fact.applicationParameterName !== undefined || fact.applicationTargetSpecifier !== undefined ||
      fact.applicationPlacement === "constructor") { reject(node, "The selected attribute has no exact supported native item placement."); return undefined; }
    if (call.sourceArguments.length !== row.arguments.length) { reject(node, "The attribute's checked arguments do not match its finite native grammar."); return undefined; }
    const arguments_ = call.sourceArguments.map((argument, index) => selectRustAttributeConstant(argument.expression, row.arguments[index]!, row, source));
    if (!arguments_.every((argument): argument is RustAttributeConstant => argument !== undefined)) {
      reject(node, "Attribute arguments require exact constant literals, tuples or checked provider fields; runtime evaluation is not permitted."); return undefined;
    }
    return Object.freeze({ sourceSubject: node, sourceFile, targetDeclaration: target, placement, provider: row, arguments: Object.freeze(arguments_) });
  }

  function selectedTarget(fact: TsonicAttributeApplicationFact, file: SourceFile): Node | undefined {
    if (fact.applicationPlacement === "module") return fact.applicationTarget === file ? file : undefined;
    if (!isAstNode(ast, fact.applicationTarget)) return undefined;
    const query = ast.as.AsTypeQueryNode(fact.applicationTarget);
    const subject = query?.ExprName ?? fact.applicationTarget;
    return source.navigation.sourceReferenceFor(subject)?.declaration ?? source.navigation.declarationFor(subject);
  }
}

const emptyApplications: readonly RustAttributeApplication[] = Object.freeze([]);
