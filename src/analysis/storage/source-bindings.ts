import { requireRustRecord } from "../program/records/objects/required-records.js";

import { KindExportAssignment, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";

import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustSourceBindingFactEquals, rustSourceCallableValueEquals } from "../../target-model/records/operations/equality.js";
import type { RustSourceCallableValueFact } from "../../target-model/records/operations/operation-selections.js";

import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import type { RustSourceBindingFact } from "../../target-model/records/objects/value-projections.js";

export function recordProjectSourceBinding(
  walk: RustFactWalk,
  identifier: Node,
): RustSourceBindingFact | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference === undefined || declaration === undefined || !reference.project ||
    isImportBindingDeclarationKind(ast.kindName(declaration))) {
    return undefined;
  }
  const declarationKind = ast.kindName(declaration);
  const declarationName = ast.name(declaration);
  const sourceName = declarationKind === KindExportAssignment
    ? "default"
    : declarationName === undefined
      ? ""
      : ast.text(declarationName);
  if (sourceName.length === 0 ||
    walk.context.names.nameForDeclaration(declaration) === undefined) {
    return undefined;
  }
  requireRustRecord(walk.context.requiredRecords, "sourceBinding", identifier, "project-reference", "recordProjectSourceBinding");
  const selected: RustSourceBindingFact = sourceDeclarationIsModuleScoped(declaration, ast)
    ? { scope: "module", sourceDeclaration: declaration, sourceName, fileName: ast.getFileName(ast.getSourceFile(declaration)) }
    : { scope: "lexical", sourceDeclaration: declaration, sourceName };
  let binding = walk.context.records.sourceBinding.get(identifier);
  if (binding !== undefined && !rustSourceBindingFactEquals(binding, selected)) {
    failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.sourceBinding' for one exact source subject.", identifier);
  }
  if (binding === undefined) binding = selected.scope === "module"
    ? walk.context.records.sourceBindings.module(identifier, declaration, sourceName, selected.fileName)
    : walk.context.records.sourceBindings.lexical(identifier, declaration, sourceName);
  const module = walk.context.records.moduleBinding.get(declaration);
  if (binding.scope === "module" && module?.storage === "native-callable" && module.value !== undefined &&
    !walk.context.source.navigation.declarationUseSummary(declaration).bindingWritten) {
    requireRustRecord(walk.context.requiredRecords, "directCallableReference", identifier, "module-callable", "recordProjectSourceBinding");
    const callable: RustSourceCallableValueFact = { form: "function", sourceDeclaration: module.callableDeclaration,
      fileName: binding.fileName, name: module.name, carrier: module.value.carrier,
      parameterCarriers: module.value.parameterCarriers, resultCarrier: module.value.resultCarrier };
    const existing = walk.context.records.directCallableReference.get(identifier);
    if (existing !== undefined && !rustSourceCallableValueEquals(existing, callable)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.directCallableReference' for one exact source subject.", identifier);
    }
    if (existing === undefined) walk.context.records.directCallableReferences.function(identifier, module.callableDeclaration,
      binding.fileName, module.name, module.value.carrier, module.value.parameterCarriers, module.value.resultCarrier);
  }
  return binding;
}

function isImportBindingDeclarationKind(kind: string): boolean {
  return kind === "KindImportSpecifier" ||
    kind === "KindImportClause" ||
    kind === "KindNamespaceImport" ||
    kind === "KindImportEqualsDeclaration";
}

export function selectedDeclarationIsProjectSource(walk: RustFactWalk, declaration: Node): boolean {
  const { ast } = walk.context;
  const kind = ast.kindName(declaration);
  if (kind.length === 0) {
    return false;
  }
  const sourceFile = ast.getSourceFile(declaration);
  return sourceFile !== undefined && walk.context.source.semantics.includes(sourceFile) && !ast.isDeclarationFile(sourceFile);
}
