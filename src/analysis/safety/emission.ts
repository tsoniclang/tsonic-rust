import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression } from "@tsonic/target-api/source";
import { sourceSafetyPositionIssue } from "@tsonic/target-api/analysis";
import { createRustExplicitUnsafeContexts, isRustIndependentSafetyBoundary } from "./explicit-regions.js";
import type { RustSafetyApplication, RustSafetyOperation } from "../../target-model/records/storage/safety.js";
import type { RustSafetyPlacement, RustSafetyEmission } from "../../target-model/records/storage/safety-emission.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSafetyEmissionProducer } from "../program/records/storage/safety-emission.js";

interface RustSafetyAnalysisInput {
  readonly program: Pick<RustAnalysisProgram, "source" | "sourceFiles" | "safetyApplications" | "records">;
}

export function analyzeRustSafetyEmission(program: RustSafetyAnalysisInput["program"], producer: RustSafetyEmissionProducer): readonly TargetDiagnostic[] {
  const input: RustSafetyAnalysisInput = { program };
  const issues: TargetDiagnostic[] = [];
  const explicit = createRustExplicitUnsafeContexts(program.source.ast, program.sourceFiles,
    node => program.safetyApplications.operationForExpression(node));
  for (const file of program.sourceFiles) diagnoseRustSafetyApplications(file, input, issues);
  const seen = new Map<Node, RustSafetyEmission>();
  const visit = (node: Node): RustSafetyEmission => {
    const previous = seen.get(node);
    if (previous !== undefined) return previous;
    const children = program.source.ast.children(node).filter((child): child is Node => child !== undefined);
    const summaries = children.map(child => ({ node: child, value: visit(child) }));
    const pointer = program.records.targetOperation.get(node);
    if (pointer?.kind === "native-pointer" && !explicit.has(node)) issues.push(targetDiagnostic(
      "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED", `Rust native-pointer '${pointer.operation}' requires an explicit unsafecontext() source region.`, node));
    const handler = program.records.nativeHandler.get(node);
    if ((handler === undefined || handler.kind === "js-string-conversion" || handler.kind === "typed-location") &&
      nodeRequiresUnsafe(node, input) && !explicit.has(node)) issues.push({ code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED", category: "error", source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafecontext() source region at this use site.", sourceNode: node });
    if (handler?.kind === "native-pointer" && handler.selection.kind === "raw-location" &&
      handler.selection.plan.operation === "reinterpret" && !explicit.has(node)) issues.push(targetDiagnostic(
        "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED", "Raw memory reinterpretation requires an explicit unsafecontext() source region.", node));
    const operation = program.safetyApplications.operationForSubject(node);
    if (operation !== undefined) {
      const issue = sourceSafetyPositionIssue(program.source.ast, node, operation,
        subject => program.safetyApplications.operationForExpression(subject));
      if (issue === "marker-runtime") issues.push(targetDiagnostic("RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED",
        "Rust declaration safety markers must be complete standalone expression statements.", node));
      if (issue === "block-position") issues.push(targetDiagnostic("RUST_UNSAFE_CONTEXT_BLOCK_POSITION_INVALID",
        "The no-argument unsafe-context marker must be handled as the first direct statement of a source block.", node));
    }
    const inherited = summaries.filter(child => !isIndependentSafetyBoundary(child.node, input));
    const selected = Object.freeze({
      nativePointer: program.records.targetOperation.get(node)?.kind === "native-pointer" || inherited.some(child => child.value.nativePointer),
      unusedUnsafe: operation?.kind === "unsafe-context" && !unsafeRegionRequiresUnsafe(node, operation, input) ||
        inherited.some(child => child.value.unusedUnsafe),
    });
    seen.set(node, selected);
    const declarations = new Map<RustSafetyPlacement, boolean>();
    for (const placement of ["declaration", "constructor", "getter", "setter"] as const)
      declarations.set(placement, rustDeclarationRequiresUnsafe(node, placement, input));
    producer.subject(node, declarations, rustSelectedCallRequiresUnsafe(node, input), new Map([
      ["getter", rustSelectedAccessorRequiresUnsafe(node, "getter", input)],
      ["setter", rustSelectedAccessorRequiresUnsafe(node, "setter", input)],
    ]), selected, program.safetyApplications.operationForExpression(node));
    return selected;
  };
  for (const file of program.sourceFiles) visit(file);
  return Object.freeze(issues);
}

function isRustExplicitUnsafeBlockMarker(
  statement: Node | undefined,
  input: RustSafetyAnalysisInput,
): boolean {
  const expression = statement === undefined ||
      input.program.source.ast.kindName(statement) !== "KindExpressionStatement"
    ? undefined
    : Node_Expression(input.program.source.ast, statement);
  const selected = expression === undefined
    ? undefined
    : exactSafetyOperation(expression, input);
  return selected?.kind === "unsafe-context" &&
    selected.fact.kind === "remaining-block";
}


function rustDeclarationRequiresUnsafe(
  declaration: Node,
  placement: RustSafetyApplication["applicationPlacement"],
  input: RustSafetyAnalysisInput,
  additionalDeclaration?: Node,
): boolean {
  const applications = uniqueApplications([
    ...input.program.safetyApplications.forDeclaration(declaration),
    ...(additionalDeclaration === undefined
      ? []
      : input.program.safetyApplications.forDeclaration(additionalDeclaration)),
  ]).filter((application) => application.applicationPlacement === placement);
  return applications.length > 0 &&
    applications.every((application) => application.contract === "requires-unsafe");
}

function rustSelectedCallRequiresUnsafe(
  call: Node,
  input: RustSafetyAnalysisInput,
): boolean {
  const selected = input.program.records.selectedCall.get(call);
  const declaration = selected?.sourceDeclaration;
  if (declaration === undefined) {
    return false;
  }
  return input.program.safetyApplications.forDeclaration(declaration).some(
    (application) =>
      application.contract === "requires-unsafe" &&
      (application.applicationPlacement === "declaration" ||
        application.applicationPlacement === "constructor"),
  );
}

function rustSelectedAccessorRequiresUnsafe(
  access: Node,
  role: "getter" | "setter",
  input: RustSafetyAnalysisInput,
): boolean {
  const selected = input.program.records.selectedOperation.get(access);
  const declaration = role === "getter"
    ? selected?.provenance?.sourceSelectedReadDeclaration
    : selected?.provenance?.sourceSelectedWriteDeclaration;
  return declaration !== undefined && input.program.safetyApplications.forDeclaration(declaration).some(
    (application) =>
      application.contract === "requires-unsafe" &&
      application.applicationPlacement === role,
  );
}


function unsafeRegionRequiresUnsafe(
  subject: Node,
  operation: Extract<RustSafetyOperation, { readonly kind: "unsafe-context" }>,
  input: RustSafetyAnalysisInput,
): boolean {
  const roots = operation.fact.kind === "expression"
    ? [operation.fact.expression]
    : remainingUnsafeRegionRoots(subject, input);
  return regionContainsDirectUnsafeRequirement(roots, input);
}

function remainingUnsafeRegionRoots(
  subject: Node,
  input: RustSafetyAnalysisInput,
): readonly Node[] {
  const ast = input.program.source.ast;
  let statement = subject;
  let parent = ast.parent(statement);
  while (parent !== undefined && ast.kindName(parent) !== "KindBlock" &&
    !ast.is.IsSourceFile(parent)) {
    statement = parent;
    parent = ast.parent(statement);
  }
  if (parent === undefined) return [];
  const statements = ast.statements(parent);
  const index = statements.indexOf(statement);
  return index < 0
    ? []
    : statements.slice(index + 1).filter((node): node is Node => node !== undefined);
}

function regionContainsDirectUnsafeRequirement(
  roots: readonly Node[],
  input: RustSafetyAnalysisInput,
): boolean {
  const pending: Node[] = [];
  pushNodesOutsideNestedRemainingRegion(pending, roots, input);
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (isIndependentSafetyBoundary(node, input)) continue;
    if (input.program.safetyApplications.operationForSubject(node)?.kind === "unsafe-context") {
      continue;
    }
    if (nodeRequiresUnsafe(node, input)) return true;
    if (input.program.source.ast.kindName(node) === "KindBlock") {
      pushNodesOutsideNestedRemainingRegion(
        pending,
        input.program.source.ast.statements(node)
          .filter((statement): statement is Node => statement !== undefined),
        input,
      );
      continue;
    }
    const children = input.program.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }
  return false;
}

function pushNodesOutsideNestedRemainingRegion(
  pending: Node[],
  nodes: readonly Node[],
  input: RustSafetyAnalysisInput,
): void {
  const markerIndex = nodes.findIndex((node) =>
    isRustExplicitUnsafeBlockMarker(node, input));
  const visible = markerIndex < 0 ? nodes : nodes.slice(0, markerIndex);
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const node = visible[index];
    if (node !== undefined) pending.push(node);
  }
}

function nodeRequiresUnsafe(
  node: Node,
  input: RustSafetyAnalysisInput,
): boolean {
  const operation = input.program.records.targetOperation.get(node);
  return operation?.kind === "native-pointer" ||
    (operation?.kind === "provider-operation" &&
      operation.abi.effects.safety === "requires-unsafe") ||
    (operation?.kind === "runtime-set" &&
      operation.abi.effects.safety === "requires-unsafe") ||
    rustSelectedCallRequiresUnsafe(node, input) ||
    rustSelectedAccessorRequiresUnsafe(node, "getter", input) ||
    rustSelectedAccessorRequiresUnsafe(node, "setter", input);
}

function isIndependentSafetyBoundary(
  node: Node,
  input: RustSafetyAnalysisInput,
): boolean {
  return isRustIndependentSafetyBoundary(input.program.source.ast, node);
}


function diagnoseRustSafetyApplications(
  sourceFile: SourceFile,
  input: RustSafetyAnalysisInput,
  diagnostics: TargetDiagnostic[],
): void {
  const conflicts = diagnoseConflictingSafetyApplications(
    sourceFile,
    input,
    diagnostics,
  );
  for (const application of input.program.safetyApplications.forSourceFile(sourceFile)) {
    if (application.targetDeclarations.length === 0) {
      diagnostics.push(targetDiagnostic(
        "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED",
        "The finalized safety application has no exact emitted Rust declaration target.",
        application.sourceSubject,
      ));
      continue;
    }
    if (application.targetDeclarations.some((declaration) => conflicts.has(declaration))) {
      continue;
    }
    if (application.contract === "safe") {
      diagnostics.push(targetDiagnostic(
        "RUST_SAFE_DECLARATION_TARGET_UNSUPPORTED",
        "Rust 'safe' is not an explicit modifier on ordinary function declarations; the selected source declaration has no Rust boundary where this contract can be emitted.",
        application.sourceSubject,
      ));
      continue;
    }
    if (!applicationHasRustUnsafeBoundary(application, input)) {
      diagnostics.push(targetDiagnostic(
        "RUST_SAFETY_APPLICATION_TARGET_UNSUPPORTED",
        "The selected source declaration has no emitted Rust function boundary that can carry an explicit unsafe contract.",
        application.sourceSubject,
      ));
    }
  }
}

function diagnoseConflictingSafetyApplications(
  sourceFile: SourceFile,
  input: RustSafetyAnalysisInput,
  diagnostics: TargetDiagnostic[],
): ReadonlySet<Node> {
  const conflicts = new Set<Node>();
  for (const application of input.program.safetyApplications.forSourceFile(sourceFile)) {
    for (const declaration of application.targetDeclarations) {
      if (conflicts.has(declaration)) {
        continue;
      }
      const related = input.program.safetyApplications.forDeclaration(declaration)
        .filter((candidate) =>
          candidate.applicationPlacement === application.applicationPlacement);
      if (new Set(related.map((candidate) => candidate.contract)).size <= 1) {
        continue;
      }
      conflicts.add(declaration);
      const first = [...related].sort((left, right) =>
        compareSafetyApplications(left, right, input))[0];
      if (first?.sourceFile !== sourceFile) {
        continue;
      }
      diagnostics.push(targetDiagnostic(
        "RUST_SAFETY_CONTRACT_CONFLICT",
        "One exact Rust declaration received conflicting finalized safe and requires-unsafe contracts.",
        first.sourceSubject,
      ));
    }
  }
  return conflicts;
}

function applicationHasRustUnsafeBoundary(
  application: RustSafetyApplication,
  input: RustSafetyAnalysisInput,
): boolean {
  return application.targetDeclarations.some((declaration) => {
    const kind = input.program.source.ast.kindName(declaration);
    if (application.applicationPlacement === "constructor") {
      return kind === "KindClassDeclaration" ||
        kind === "KindConstructor" ||
        kind === "KindConstructorDeclaration";
    }
    if (application.applicationPlacement === "getter") {
      return kind === "KindGetAccessor";
    }
    if (application.applicationPlacement === "setter") {
      return kind === "KindSetAccessor";
    }
    if (application.applicationPlacement !== "declaration") {
      return false;
    }
    return kind === "KindFunctionDeclaration" ||
      kind === "KindMethodDeclaration" ||
      kind === "KindMethodSignature";
  });
}

function exactSafetyOperation(
  expression: Node,
  input: RustSafetyAnalysisInput,
): RustSafetyOperation | undefined {
  return input.program.safetyApplications.operationForExpression(expression);
}

function uniqueApplications(
  applications: readonly RustSafetyApplication[],
): readonly RustSafetyApplication[] {
  return [...new Set(applications)];
}

function compareSafetyApplications(
  left: RustSafetyApplication,
  right: RustSafetyApplication,
  input: RustSafetyAnalysisInput,
): number {
  const pathOrder = input.program.source.ast.getPath(left.sourceFile).localeCompare(
    input.program.source.ast.getPath(right.sourceFile),
  );
  return pathOrder !== 0
    ? pathOrder
    : input.program.source.ast.pos(left.sourceSubject) - input.program.source.ast.pos(right.sourceSubject);
}

function targetDiagnostic(
  code: string,
  message: string,
  sourceNode: Node,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    sourceNode,
  };
}
