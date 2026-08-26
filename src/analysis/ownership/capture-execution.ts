import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  getRustGeneratorProtocol,
  rustCallableProtocol,
  rustSendTrait,
  rustSyncTrait,
} from "../../target-model/types/index.js";
import { rustSemanticIdentitiesEqual } from "../../target-model/semantics/index.js";
import type {
  RustBound,
  RustExecutionDomain,
  RustExecutionStorage,
  RustLifetimeRef,
  RustSuspensionPoint,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import type { RustSourceFlowGraph, RustSourceFlowPoint } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import {
  RustOwnershipComplexityError,
  rustSuspensionPointComplexityDiagnostic,
} from "./complexity.js";

export interface RustExecutionRequirement {
  readonly kind: RustExecutionDomain;
  readonly storage: RustExecutionStorage;
  readonly lifetime?: RustLifetimeRef;
  readonly requiresSend: boolean;
  readonly requiresSync: boolean;
  readonly requiresStatic: boolean;
}

export function executionRequirementsForCarrier(carrier: RustTypeRef): RustExecutionRequirement {
  const callable = rustCallableProtocol(carrier);
  if (callable !== undefined) {
    const threaded = callable.storage === "threaded";
    return Object.freeze({
      kind: threaded ? "threaded" : "local",
      storage: callable.storage === "borrowed-local" ? "borrowed" : "owned",
      lifetime: callable.lifetime ?? Object.freeze({ kind: "static" as const }),
      requiresSend: threaded,
      requiresSync: threaded,
      requiresStatic: callable.storage !== "borrowed-local",
    });
  }
  const generator = getRustGeneratorProtocol(carrier);
  if (generator !== undefined) {
    return Object.freeze({
      kind: "local",
      storage: generator.storage,
      lifetime: generator.lifetime ?? Object.freeze({ kind: "static" as const }),
      requiresSend: false,
      requiresSync: false,
      requiresStatic: generator.storage === "owned",
    });
  }
  return Object.freeze({
    kind: "local",
    storage: carrier.kind === "function-pointer" ? "owned" : "borrowed",
    ...(carrier.kind === "function-pointer"
      ? { lifetime: Object.freeze({ kind: "static" as const }) }
      : {}),
    requiresSend: false,
    requiresSync: false,
    requiresStatic: carrier.kind === "function-pointer",
  });
}

export function executionRequirementsForBound(
  bound: RustBound,
): readonly RustExecutionRequirement[] {
  if (bound.kind === "trait" && bound.polarity === "required") {
    const requiresSend = rustSemanticIdentitiesEqual(bound.trait.identity, rustSendTrait.identity);
    const requiresSync = rustSemanticIdentitiesEqual(bound.trait.identity, rustSyncTrait.identity);
    return requiresSend || requiresSync
      ? [Object.freeze({
          kind: "threaded" as const,
          storage: "borrowed" as const,
          requiresSend,
          requiresSync,
          requiresStatic: false,
        })]
      : [];
  }
  if (bound.kind === "type-outlives") {
    return [Object.freeze({
      kind: "local" as const,
      storage: bound.lifetime.kind === "static" ? "owned" as const : "borrowed" as const,
      lifetime: bound.lifetime,
      requiresSend: false,
      requiresSync: false,
      requiresStatic: bound.lifetime.kind === "static",
    })];
  }
  return [];
}

export function collectSuspensionPoints(
  callable: Node,
  flow: RustSourceFlowGraph,
): readonly RustSuspensionPoint[] {
  const points: RustSuspensionPoint[] = [];
  const callableRegionId = flow.exitsFor(callable)[0]?.regionId;
  if (callableRegionId === undefined) return Object.freeze([]);
  for (const point of flow.points) {
    if (point.regionId !== callableRegionId || point.suspension === undefined) continue;
    const complexity = rustSuspensionPointComplexityDiagnostic(
      points.length + 1,
      point.node ?? point.resourceCleanup?.declaration,
    );
    if (complexity !== undefined) throw new RustOwnershipComplexityError(complexity);
    points.push(Object.freeze({
      occurrenceId: point.suspension.occurrenceId,
      flowPointId: point.id,
      kind: point.suspension.kind,
      region: Object.freeze({
        id: `${point.id}\0suspension`,
        kind: "suspension",
        parentId: point.regionId,
      }),
    }));
  }
  return Object.freeze(points);
}

export function captureCrossesSuspension(
  references: readonly Node[],
  suspensionPoints: readonly RustSuspensionPoint[],
  flowPointById: ReadonlyMap<string, RustSourceFlowPoint>,
  flow: RustSourceFlowGraph,
): boolean {
  if (suspensionPoints.length === 0) return false;
  return suspensionPoints.some((suspension) => {
    const suspensionPoint = flowPointById.get(suspension.flowPointId);
    return suspensionPoint !== undefined && references.some((reference) =>
      flow.reaches(suspensionPoint, reference));
  });
}

export function enclosingCallInput(
  node: Node,
  input: RustOwnershipAnalysisInput,
): {
  readonly call: Node;
  readonly input: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly index: number };
} | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallable(parent, input.ast)) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindCallExpression" || kind === "KindNewExpression") {
      const index = input.ast.arguments(parent).findIndex((argument) =>
        argument === current || argument !== undefined && nodeContains(argument, current, input));
      if (index >= 0) {
        return { call: parent, input: { kind: "argument", index } };
      }
      const callee = Node_Expression(input.ast, parent);
      const calleeKind = callee === undefined ? undefined : input.ast.kindName(callee);
      const receiver = calleeKind === "KindPropertyAccessExpression" ||
          calleeKind === "KindElementAccessExpression"
        ? Node_Expression(input.ast, callee)
        : undefined;
      return receiver !== undefined && (receiver === current || nodeContains(receiver, current, input))
        ? { call: parent, input: { kind: "receiver" } }
        : undefined;
    }
    current = parent;
  }
}

export function nodeContains(
  root: Node,
  selected: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  let current: Node | undefined = selected;
  while (current !== undefined) {
    if (current === root) return true;
    current = input.ast.parent(current);
  }
  return false;
}

export function isCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

export function exactCallableExpression(
  node: Node,
  ast: AstReader,
): Node | undefined {
  let current = node;
  while (isTransparentExpression(current, ast)) {
    const expression = Node_Expression(ast, current);
    if (expression === undefined) return undefined;
    current = expression;
  }
  return isCallable(current, ast) ? current : undefined;
}

function isTransparentExpression(node: Node, ast: AstReader): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsSatisfiesExpression(node) || ast.is.IsNonNullExpression(node) ||
    ast.is.IsTypeAssertionExpression(node);
}

export function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    if (isCallable(current, ast)) return current;
    current = ast.parent(current);
  }
  return undefined;
}
