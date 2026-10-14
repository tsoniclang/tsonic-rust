import { type RustAttribute } from "../../target-ast/syntax/attributes.js";
import type {
  Node,
} from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type {
  RustSafetyApplication,
  RustSafetyOperation,
} from "../../../target-model/records/safety.js";
import type {
  RustPlanningContext,
} from "../context.js";
import type {
  RustExpr,
} from "../../target-ast/syntax/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import type {
  RustPlanContext,
} from "../program/plan-context.js";
import { Node_Expression } from "@tsonic/target-api/source";

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
    ...input.program.safetyApplications.safetyApplication.get(declaration),
    ...(additionalDeclaration === undefined
      ? []
      : input.program.safetyApplications.safetyApplication.get(additionalDeclaration)),
  ]).filter((application) => application.applicationPlacement === placement);
  return applications.length > 0 &&
    applications.every((application) => application.contract === "requires-unsafe");
}

export function rustSelectedCallRequiresUnsafe(
  call: Node,
  input: RustPlanningContext,
): boolean {
  const selected = input.program.records.selectedCall.get(call);
  const declaration = selected?.sourceDeclaration;
  if (declaration === undefined) {
    return false;
  }
  return input.program.safetyApplications.safetyApplication.get(declaration).some(
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
  const selected = input.program.records.selectedOperation.get(access);
  const declaration = role === "getter"
    ? selected?.provenance?.sourceSelectedReadDeclaration
    : selected?.provenance?.sourceSelectedWriteDeclaration;
  return declaration !== undefined && input.program.safetyApplications.safetyApplication.get(declaration).some(
    (application) =>
      application.contract === "requires-unsafe" &&
      application.applicationPlacement === role,
  );
}

export function rustSafetyAttributesForDeclaration(
  declaration: Node,
  isUnsafe: boolean,
  input: RustPlanningContext,
): readonly RustAttribute[] {
  let hasNativePointerOperation = false;
  let hasUnusedExplicitUnsafeContext = false;
  walkDeclarationSubtree(declaration, input, (node) => {
    const safetyOperation = input.program.safetyApplications.safetySubjectOperation.get(node);
    if (safetyOperation?.kind === "unsafe-context" &&
      !unsafeRegionRequiresUnsafe(node, safetyOperation, input)) {
      hasUnusedExplicitUnsafeContext = true;
    }
    hasNativePointerOperation ||=
      input.program.records.targetOperation.get(node)?.kind ===
        "native-pointer";
  });
  return [
    ...(isUnsafe ? [rustLintAttributes.missingSafetyDoc] : []),
    ...(!isUnsafe && hasNativePointerOperation
      ? [rustLintAttributes.pointerDerefOutsideUnsafeFunction]
      : []),
    ...(hasUnusedExplicitUnsafeContext ? [rustLintAttributes.unusedUnsafe] : []),
  ];
}

function unsafeRegionRequiresUnsafe(
  subject: Node,
  operation: Extract<RustSafetyOperation, { readonly kind: "unsafe-context" }>,
  input: RustPlanningContext,
): boolean {
  const roots = operation.fact.kind === "expression"
    ? [operation.fact.expression]
    : remainingUnsafeRegionRoots(subject, input);
  return regionContainsDirectUnsafeRequirement(roots, input);
}

function remainingUnsafeRegionRoots(
  subject: Node,
  input: RustPlanningContext,
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
  input: RustPlanningContext,
): boolean {
  const pending: Node[] = [];
  pushNodesOutsideNestedRemainingRegion(pending, roots, input);
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (isIndependentSafetyBoundary(node, input)) continue;
    if (input.program.safetyApplications.safetySubjectOperation.get(node)?.kind === "unsafe-context") {
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
  input: RustPlanningContext,
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
  input: RustPlanningContext,
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

function walkDeclarationSubtree(
  root: Node,
  input: RustPlanningContext,
  visit: (node: Node) => void,
): void {
  const pending: Node[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (node !== root && isIndependentSafetyBoundary(node, input)) continue;
    visit(node);
    const children = input.program.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }
}

function isIndependentSafetyBoundary(
  node: Node,
  input: RustPlanningContext,
): boolean {
  switch (input.program.source.ast.kindName(node)) {
    case "KindFunctionDeclaration":
    case "KindMethodDeclaration":
    case "KindMethodSignature":
    case "KindConstructor":
    case "KindConstructorDeclaration":
    case "KindGetAccessor":
    case "KindSetAccessor":
      return true;
    default:
      return false;
  }
}

function exactSafetyOperation(
  expression: Node,
  input: RustPlanningContext,
): RustSafetyOperation | undefined {
  return input.program.safetyApplications.safetyOperation.get(expression);
}

function uniqueApplications(
  applications: readonly RustSafetyApplication[],
): readonly RustSafetyApplication[] {
  return [...new Set(applications)];
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
