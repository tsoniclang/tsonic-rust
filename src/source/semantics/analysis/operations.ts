import type {
  Node,
  ProviderDeclarationIdentity,
  ResolvedSourceCallInfo,
  SourceAnalysisContext,
} from "@tsonic/tsts";
import {
  rustSourceDeclarationFactKey,
  rustSourceOwnershipOperationFactKey,
  rustSourcePointerOperationFactKey,
} from "../facts.js";
import {
  rustDeclarationBuilderExportId,
  rustDeclarationBuilderMemberIds,
  rustLangModule,
  rustSourceOperationExportIds,
  rustSourceOperationSignatureIds,
  rustSourceVirtualModulesProviderId,
} from "../identity.js";
import type {
  RustSourceDeclarationApplication,
  RustSourceDeclarationFact,
  RustSourceOwnershipOperationFact,
  RustSourceOwnershipOperationKind,
  RustSourcePointerOperationFact,
} from "../model.js";
import {
  appendRustSourceDiagnostic,
  forEachRustSourceFile,
  readRustSourceFact,
  selectedRustProviderCall,
  visitRustSourcePostOrder,
} from "./context.js";
import type { RustSourceFileAnalysisContext } from "./context.js";

const ownershipOperationBySignature = new Map<string, RustSourceOwnershipOperationKind>([
  [rustSourceOperationSignatureIds.sharedBorrow, "shared-borrow"],
  [rustSourceOperationSignatureIds.mutableBorrow, "mutable-borrow"],
  [rustSourceOperationSignatureIds.move, "move"],
  [rustSourceOperationSignatureIds.clone, "clone"],
  [rustSourceOperationSignatureIds.own, "own"],
  [rustSourceOperationSignatureIds.loadShared, "load"],
  [rustSourceOperationSignatureIds.loadMutable, "load"],
  [rustSourceOperationSignatureIds.store, "store"],
  [rustSourceOperationSignatureIds.replace, "replace"],
  [rustSourceOperationSignatureIds.take, "take"],
  [rustSourceOperationSignatureIds.captureMove, "capture-move"],
]);

export function analyzeRustSourceOperations(context: SourceAnalysisContext): void {
  forEachRustSourceFile(context, (sourceContext): void => {
    visitRustSourcePostOrder(sourceContext.sourceFile, sourceContext, (node): void => {
      const selected = selectedRustProviderCall(node, sourceContext);
      if (selected === undefined ||
        selected.declaration.providerId !== rustSourceVirtualModulesProviderId ||
        selected.declaration.providerModuleId !== rustLangModule) {
        return;
      }
      const ownership = selected.declaration.signatureId === undefined
        ? undefined
        : ownershipOperationBySignature.get(selected.declaration.signatureId);
      if (ownership !== undefined) {
        analyzeOwnershipOperation(
          node,
          selected.selection,
          selected.declaration,
          ownership,
          sourceContext,
        );
        return;
      }
      if (selected.declaration.exportId === rustSourceOperationExportIds.declaration ||
        selected.declaration.exportId === rustDeclarationBuilderExportId) {
        analyzeDeclarationOperation(
          node,
          selected.selection,
          selected.declaration,
          sourceContext,
        );
        return;
      }
      analyzePointerOperation(
        node,
        selected.selection,
        selected.declaration,
        sourceContext,
      );
    });
  });
}

function analyzeOwnershipOperation(
  call: Node,
  selection: ResolvedSourceCallInfo,
  declaration: ProviderDeclarationIdentity,
  kind: RustSourceOwnershipOperationKind,
  context: RustSourceFileAnalysisContext,
): void {
  const value = selection.sourceArguments[0];
  const replacement = selection.sourceArguments[1];
  if (value === undefined ||
    ((kind === "store" || kind === "replace") && replacement === undefined)) {
    appendRustSourceDiagnostic(
      context,
      call,
      "RUST_SOURCE_OWNERSHIP_EVIDENCE_MISSING",
      9300110,
      `Rust '${kind}' operation is missing exact selected operand evidence.`,
    );
    return;
  }
  const fact: RustSourceOwnershipOperationFact = {
    kind,
    call,
    valueExpression: value.expression,
    valueType: value.type,
    ...(replacement === undefined
      ? {}
      : {
          replacementExpression: replacement.expression,
          replacementType: replacement.type,
        }),
    resultType: selection.sourceResultType,
    selectedDeclaration: declaration,
  };
  writeOperationFact(
    call,
    rustSourceOwnershipOperationFactKey,
    fact,
    "RUST_SOURCE_OWNERSHIP_FACT_WRITE_FAILED",
    9300111,
    context,
  );
}

function analyzePointerOperation(
  call: Node,
  selection: ResolvedSourceCallInfo,
  declaration: ProviderDeclarationIdentity,
  context: RustSourceFileAnalysisContext,
): void {
  const signatureId = declaration.signatureId;
  const first = selection.sourceArguments[0];
  const second = selection.sourceArguments[1];
  const pointee = selection.sourceSelectedMethodTypeArguments?.[0];
  let fact: RustSourcePointerOperationFact | undefined;
  if (signatureId === rustSourceOperationSignatureIds.exposeConstPointerAddress ||
    signatureId === rustSourceOperationSignatureIds.exposeMutablePointerAddress) {
    if (first !== undefined) {
      fact = {
        kind: "expose-address",
        call,
        pointerExpression: first.expression,
        pointerType: first.type,
        mutable: signatureId === rustSourceOperationSignatureIds.exposeMutablePointerAddress,
        resultType: selection.sourceResultType,
        selectedDeclaration: declaration,
      };
    }
  } else if (signatureId === rustSourceOperationSignatureIds.constPointerFromExposedAddress ||
    signatureId === rustSourceOperationSignatureIds.mutablePointerFromExposedAddress) {
    if (first !== undefined && pointee !== undefined) {
      fact = {
        kind: "restore-exposed-address",
        call,
        addressExpression: first.expression,
        addressType: first.type,
        pointeeType: pointee.selectedType,
        ...(pointee.explicitTypeNode === undefined
          ? {}
          : { explicitPointeeTypeNode: pointee.explicitTypeNode }),
        mutable: signatureId === rustSourceOperationSignatureIds.mutablePointerFromExposedAddress,
        resultType: selection.sourceResultType,
        selectedDeclaration: declaration,
      };
    }
  } else if (signatureId === rustSourceOperationSignatureIds.readVolatile) {
    if (first !== undefined && pointee !== undefined) {
      fact = {
        kind: "read-volatile",
        call,
        pointerExpression: first.expression,
        pointerType: first.type,
        pointeeType: pointee.selectedType,
        ...(pointee.explicitTypeNode === undefined
          ? {}
          : { explicitPointeeTypeNode: pointee.explicitTypeNode }),
        resultType: selection.sourceResultType,
        selectedDeclaration: declaration,
      };
    }
  } else if (signatureId === rustSourceOperationSignatureIds.writeVolatile) {
    if (first !== undefined && second !== undefined && pointee !== undefined) {
      fact = {
        kind: "write-volatile",
        call,
        pointerExpression: first.expression,
        pointerType: first.type,
        valueExpression: second.expression,
        valueType: second.type,
        pointeeType: pointee.selectedType,
        ...(pointee.explicitTypeNode === undefined
          ? {}
          : { explicitPointeeTypeNode: pointee.explicitTypeNode }),
        resultType: selection.sourceResultType,
        selectedDeclaration: declaration,
      };
    }
  } else {
    return;
  }
  if (fact === undefined) {
    appendRustSourceDiagnostic(
      context,
      call,
      "RUST_SOURCE_POINTER_EVIDENCE_MISSING",
      9300112,
      "Rust pointer operation is missing exact selected operand or type evidence.",
    );
    return;
  }
  writeOperationFact(
    call,
    rustSourcePointerOperationFactKey,
    fact,
    "RUST_SOURCE_POINTER_FACT_WRITE_FAILED",
    9300113,
    context,
  );
}

function analyzeDeclarationOperation(
  call: Node,
  selection: ResolvedSourceCallInfo,
  declaration: ProviderDeclarationIdentity,
  context: RustSourceFileAnalysisContext,
): void {
  if (declaration.exportId === rustSourceOperationExportIds.declaration &&
    declaration.memberId === undefined) {
    const target = selection.sourceArguments[0]?.expression ??
      selection.sourceSelectedMethodTypeArguments?.[0]?.explicitTypeNode;
    if (target === undefined) {
      appendRustSourceDiagnostic(
        context,
        call,
        "RUST_SOURCE_DECLARATION_TARGET_MISSING",
        9300114,
        "rust(...) requires one exact value or explicit type application target.",
      );
      return;
    }
    writeOperationFact(
      call,
      rustSourceDeclarationFactKey,
      {
        kind: "builder-state",
        call,
        applicationTarget: target,
        selectedDeclaration: declaration,
      },
      "RUST_SOURCE_DECLARATION_FACT_WRITE_FAILED",
      9300115,
      context,
    );
    return;
  }
  const memberId = declaration.memberId;
  if (memberId === undefined) return;
  const predecessor = declarationBuilderReceiver(call, context);
  const state = readRustSourceFact(context, predecessor, rustSourceDeclarationFactKey);
  const application = declarationApplication(
    memberId,
    selection,
  );
  if (predecessor === undefined || state === undefined || application === undefined) {
    appendRustSourceDiagnostic(
      context,
      call,
      "RUST_SOURCE_DECLARATION_CHAIN_INVALID",
      9300116,
      "Rust declaration control requires one exact predecessor builder fact and complete selected operands.",
    );
    return;
  }
  const fact: RustSourceDeclarationFact = {
    kind: "application",
    call,
    applicationTarget: state.applicationTarget,
    application,
    predecessor,
    selectedDeclaration: declaration,
  };
  writeOperationFact(
    call,
    rustSourceDeclarationFactKey,
    fact,
    "RUST_SOURCE_DECLARATION_FACT_WRITE_FAILED",
    9300115,
    context,
  );
}

function declarationBuilderReceiver(
  call: Node,
  context: RustSourceFileAnalysisContext,
): Node | undefined {
  let callee = context.ast.as.AsCallExpression(call)?.Expression;
  while (callee !== undefined && context.ast.is.IsParenthesizedExpression(callee)) {
    callee = context.ast.as.AsParenthesizedExpression(callee)?.Expression;
  }
  return callee !== undefined && context.ast.is.IsPropertyAccessExpression(callee)
    ? context.ast.as.AsPropertyAccessExpression(callee)?.Expression
    : undefined;
}

function declarationApplication(
  memberId: string,
  selection: ResolvedSourceCallInfo,
): RustSourceDeclarationApplication | undefined {
  const first = selection.sourceArguments[0]?.expression;
  const trait = selection.sourceSelectedMethodTypeArguments?.[0]?.explicitTypeNode;
  switch (memberId) {
    case rustDeclarationBuilderMemberIds.extern:
      return first === undefined ? undefined : { operation: "extern", abiExpression: first };
    case rustDeclarationBuilderMemberIds.variadic:
      return { operation: "variadic" };
    case rustDeclarationBuilderMemberIds.reprC:
      return { operation: "repr-c" };
    case rustDeclarationBuilderMemberIds.reprTransparent:
      return { operation: "repr-transparent" };
    case rustDeclarationBuilderMemberIds.reprPacked:
      return first === undefined ? undefined : { operation: "repr-packed", alignmentExpression: first };
    case rustDeclarationBuilderMemberIds.reprAlign:
      return first === undefined ? undefined : { operation: "repr-align", alignmentExpression: first };
    case rustDeclarationBuilderMemberIds.union:
      return { operation: "union" };
    case rustDeclarationBuilderMemberIds.mutableStatic:
      return { operation: "mutable-static" };
    case rustDeclarationBuilderMemberIds.threadLocal:
      return { operation: "thread-local" };
    case rustDeclarationBuilderMemberIds.unsafeTrait:
      return { operation: "unsafe-trait" };
    case rustDeclarationBuilderMemberIds.unsafeImpl:
      return trait === undefined ? undefined : { operation: "unsafe-impl", traitTypeNode: trait };
    case rustDeclarationBuilderMemberIds.negativeImpl:
      return trait === undefined ? undefined : { operation: "negative-impl", traitTypeNode: trait };
    case rustDeclarationBuilderMemberIds.drop:
      return { operation: "drop" };
    default:
      return undefined;
  }
}

function writeOperationFact<T>(
  call: Node,
  key: import("@tsonic/tsts").ExtensionFactKey<T>,
  fact: T,
  code: string,
  number: number,
  context: RustSourceFileAnalysisContext,
): void {
  const result = context.facts.set(call, key, fact, [{
    message: "Rust source operation selected by exact provider declaration and signature identity.",
  }]);
  if (result !== "inserted" && result !== "idempotent") {
    appendRustSourceDiagnostic(
      context,
      call,
      code,
      number,
      `Rust source operation fact could not be recorded (${result}).`,
    );
  }
}
