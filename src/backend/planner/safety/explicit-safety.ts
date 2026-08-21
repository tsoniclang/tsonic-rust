import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type {
  RustSafetyApplication,
  RustSafetyOperation,
} from "../../../analysis/safety/application-index.js";
import type {
  RustPlanningContext,
} from "../context.js";
import type {
  RustExpr,
} from "../../target-ast/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import type {
  RustPlanContext,
} from "../program/plan-context.js";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";

export type RustExplicitSafetyExpressionPlan =
  | { readonly handled: false }
  | { readonly handled: true; readonly expression?: RustExpr };

export function tryPlanRustExplicitSafetyExpression(
  node: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExplicitSafetyExpressionPlan {
  const selected = exactSafetyOperation(node, context.input);
  if (selected?.kind !== "unsafe-context") {
    if (selected?.kind === "safety-builder") {
      context.diagnostics.push(targetDiagnostic(
        "RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED",
        "Rust declaration safety markers must be complete standalone expression statements.",
        node,
      ));
      return { handled: true };
    }
    return { handled: false };
  }
  if (selected.fact.kind !== "expression") {
    context.diagnostics.push(targetDiagnostic(
      "RUST_UNSAFE_CONTEXT_BLOCK_POSITION_INVALID",
      "The no-argument unsafe-context marker must be handled as the first direct statement of a source block.",
      node,
    ));
    return { handled: true };
  }
  const expression = planExpression(
    selected.fact.expression,
    withExplicitUnsafeContext(context),
  );
  return {
    handled: true,
    ...(expression === undefined
      ? {}
      : { expression: { kind: "unsafe", expression } }),
  };
}

export function isRustExplicitUnsafeBlockMarker(
  statement: Node | undefined,
  input: RustPlanningContext,
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

export function isErasedRustSafetyExpressionStatement(
  statement: Node,
  input: RustPlanningContext,
): boolean {
  if (input.program.source.ast.kindName(statement) !== "KindExpressionStatement") {
    return false;
  }
  const expression = Node_Expression(input.program.source.ast, statement);
  if (expression === undefined) {
    return false;
  }
  const selected = exactSafetyOperation(expression, input);
  return (selected?.kind === "safety-builder" &&
      selected.fact.kind === "application") ||
    (selected?.kind === "unsafe-context" &&
      selected.fact.kind === "remaining-block");
}

export function withExplicitUnsafeContext(
  context: RustPlanContext,
): RustPlanContext {
  return {
    ...context,
    explicitUnsafeContextDepth: (context.explicitUnsafeContextDepth ?? 0) + 1,
  };
}

export function rustDeclarationRequiresUnsafe(
  declaration: Node,
  placement: RustSafetyApplication["applicationPlacement"],
  input: RustPlanningContext,
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

export function rustSelectedCallRequiresUnsafe(
  call: Node,
  input: RustPlanningContext,
): boolean {
  const selected = input.program.facts.getSelectedTargetCall(call);
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

export function rustSelectedAccessorRequiresUnsafe(
  access: Node,
  role: "getter" | "setter",
  input: RustPlanningContext,
): boolean {
  const selected = input.program.facts.getSelectedTargetProperty(access);
  const declaration = role === "getter"
    ? selected?.provenance?.sourceSelectedReadDeclaration
    : selected?.provenance?.sourceSelectedWriteDeclaration;
  return declaration !== undefined && input.program.safetyApplications.forDeclaration(declaration).some(
    (application) =>
      application.contract === "requires-unsafe" &&
      application.applicationPlacement === role,
  );
}

export function rustSafetyAttributesForDeclaration(
  declaration: Node,
  isUnsafe: boolean,
  input: RustPlanningContext,
): readonly string[] {
  let hasExplicitUnsafeContext = false;
  let hasNativePointerOperation = false;
  walkSubtree(declaration, input, (node) => {
    const operation = input.program.safetyApplications.operationForSubject(node);
    hasExplicitUnsafeContext ||= operation?.kind === "unsafe-context";
    hasNativePointerOperation ||=
      input.program.facts.getFact(node, rustTargetOperationFactKey)?.kind ===
        "native-pointer";
  });
  return [
    ...(isUnsafe ? [rustLintAttributes.missingSafetyDoc] : []),
    ...(!isUnsafe && hasNativePointerOperation
      ? [rustLintAttributes.pointerDerefOutsideUnsafeFunction]
      : []),
    ...(hasExplicitUnsafeContext ? [rustLintAttributes.unusedUnsafe] : []),
  ];
}

export function diagnoseRustSafetyApplications(
  sourceFile: SourceFile,
  input: RustPlanningContext,
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
  input: RustPlanningContext,
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
  input: RustPlanningContext,
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
  input: RustPlanningContext,
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
  input: RustPlanningContext,
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

function walkSubtree(
  root: Node,
  input: RustPlanningContext,
  visit: (node: Node) => void,
): void {
  const pending: Node[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    visit(node);
    const children = input.program.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
