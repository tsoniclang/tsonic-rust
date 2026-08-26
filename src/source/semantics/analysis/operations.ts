import type {
  Node,
  ProviderDeclarationIdentity,
  ResolvedSourceCallInfo,
  SourceAnalysisContext,
} from "@tsonic/tsts";
import { rustSourceReferenceOperationFactKey } from "../facts.js";
import {
  rustLangModule,
  rustSourceOperationSignatureIds,
  rustSourceVirtualModulesProviderId,
} from "../identity.js";
import type {
  RustSourceReferenceOperationFact,
  RustSourceReferenceOperationKind,
} from "../model.js";
import {
  appendRustSourceDiagnostic,
  forEachRustSourceFile,
  selectedRustProviderCall,
  visitRustSourcePostOrder,
} from "./context.js";
import type { RustSourceFileAnalysisContext } from "./context.js";

const operationBySignature = new Map<string, RustSourceReferenceOperationKind>([
  [rustSourceOperationSignatureIds.sharedReference, "shared-reference"],
  [rustSourceOperationSignatureIds.mutableReference, "mutable-reference"],
  [rustSourceOperationSignatureIds.loadShared, "load"],
  [rustSourceOperationSignatureIds.loadMutable, "load"],
  [rustSourceOperationSignatureIds.store, "store"],
]);

export function analyzeRustSourceOperations(context: SourceAnalysisContext): void {
  forEachRustSourceFile(context, (sourceContext): void => {
    visitRustSourcePostOrder(sourceContext.sourceFile, sourceContext, (node): void => {
      const selected = selectedRustProviderCall(node, sourceContext);
      if (selected?.declaration.providerId !== rustSourceVirtualModulesProviderId ||
        selected.declaration.providerModuleId !== rustLangModule ||
        selected.declaration.signatureId === undefined) {
        return;
      }
      const kind = operationBySignature.get(selected.declaration.signatureId);
      if (kind !== undefined) {
        analyzeReferenceOperation(
          node,
          selected.selection,
          selected.declaration,
          kind,
          sourceContext,
        );
      }
    });
  });
}

function analyzeReferenceOperation(
  call: Node,
  selection: ResolvedSourceCallInfo,
  declaration: ProviderDeclarationIdentity,
  kind: RustSourceReferenceOperationKind,
  context: RustSourceFileAnalysisContext,
): void {
  const reference = selection.sourceArguments[0];
  const value = selection.sourceArguments[1];
  if (reference === undefined || (kind === "store" && value === undefined)) {
    appendRustSourceDiagnostic(
      context,
      call,
      "RUST_SOURCE_REFERENCE_EVIDENCE_MISSING",
      9300110,
      `Rust '${kind}' operation is missing exact selected operand evidence.`,
    );
    return;
  }
  const base = {
    call,
    resultType: selection.sourceResultType,
    selectedDeclaration: declaration,
  };
  const fact: RustSourceReferenceOperationFact = kind === "shared-reference" ||
      kind === "mutable-reference"
    ? {
        ...base,
        kind,
        valueExpression: reference.expression,
        valueType: reference.type,
        ...explicitReferenceLifetime(call, context),
      }
    : kind === "load"
      ? {
          ...base,
          kind,
          referenceExpression: reference.expression,
          referenceType: reference.type,
        }
      : {
          ...base,
          kind,
          referenceExpression: reference.expression,
          referenceType: reference.type,
          valueExpression: value!.expression,
          valueType: value!.type,
        };
  const result = context.facts.set(
    call,
    rustSourceReferenceOperationFactKey,
    fact,
    [{ message: "Rust reference operation selected by exact provider signature identity." }],
  );
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      call,
      "RUST_SOURCE_REFERENCE_FACT_WRITE_FAILED",
      9300111,
      `Rust reference operation fact could not be recorded (${result}).`,
    );
  }
}

function explicitReferenceLifetime(
  call: Node,
  context: RustSourceFileAnalysisContext,
): { readonly lifetimeTypeNode?: Node } {
  const typeArguments = context.ast.typeArguments(call);
  const lifetimeTypeNode = typeArguments.length === 2 ? typeArguments[1] : undefined;
  return lifetimeTypeNode === undefined ? {} : { lifetimeTypeNode };
}
