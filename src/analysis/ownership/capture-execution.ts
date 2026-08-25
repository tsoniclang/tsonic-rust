import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  getRustGeneratorProtocol,
  rustCallableProtocol,
  rustSendTrait,
  rustSyncTrait,
} from "../../target-model/types/index.js";
import {
  rustSemanticIdentitiesEqual,
  rustTypeSemanticKey,
} from "../../target-model/semantics/index.js";
import type {
  RustBound,
  RustExecutionDomain,
  RustExecutionStorage,
  RustGenericArgument,
  RustLifetimeRef,
  RustSuspensionPoint,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import type { RustSourceFlowGraph } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";

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
    const retainedLifetime = generator.lifetime ?? generatorExecutionLifetime(generator);
    return Object.freeze({
      kind: "local",
      storage: generator.storage === "borrowed" || retainedLifetime !== undefined
        ? "borrowed"
        : "owned",
      lifetime: retainedLifetime ?? Object.freeze({ kind: "static" as const }),
      requiresSend: false,
      requiresSync: false,
      requiresStatic: generator.storage === "owned" && retainedLifetime === undefined,
    });
  }
  const traits = executionTraits(carrier);
  const requiresSend = traits.some((trait) =>
    rustSemanticIdentitiesEqual(trait.identity, rustSendTrait.identity));
  const requiresSync = traits.some((trait) =>
    rustSemanticIdentitiesEqual(trait.identity, rustSyncTrait.identity));
  return Object.freeze({
    kind: requiresSend || requiresSync ? "threaded" : "local",
    storage: carrier.kind === "function-pointer" ? "owned" : "borrowed",
    lifetime: carrier.kind === "function-pointer"
      ? Object.freeze({ kind: "static" as const })
      : executionLifetime(carrier) ?? Object.freeze({
          kind: "inferred-region" as const,
          regionId: `carrier\0${rustTypeSemanticKey(carrier)}`,
        }),
    requiresSend,
    requiresSync,
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

function generatorExecutionLifetime(
  protocol: import("../../target-model/types/index.js").RustGeneratorProtocol,
): RustLifetimeRef | undefined {
  return executionLifetime(protocol.yieldType) ??
    executionLifetime(protocol.returnType) ??
    executionLifetime(protocol.nextType);
}

function executionTraits(carrier: RustTypeRef): readonly RustTraitRef[] {
  switch (carrier.kind) {
    case "trait-object":
      return Object.freeze([carrier.principal, ...carrier.autoTraits]);
    case "path":
      return Object.freeze([
        ...carrier.traitImplementations.map((entry) => entry.trait),
        ...carrier.arguments.flatMap(genericArgumentExecutionTraits),
      ]);
    case "tuple":
      return Object.freeze(carrier.elements.flatMap(executionTraits));
    case "array":
    case "sequence":
    case "slice":
      return executionTraits(carrier.element);
    case "reference":
    case "raw-pointer":
      return executionTraits(carrier.target);
    default:
      return Object.freeze([]);
  }
}

function genericArgumentExecutionTraits(argument: RustGenericArgument): readonly RustTraitRef[] {
  return argument.kind === "type" ? executionTraits(argument.value) : Object.freeze([]);
}

function executionLifetime(carrier: RustTypeRef): RustLifetimeRef | undefined {
  switch (carrier.kind) {
    case "trait-object":
    case "reference":
      return carrier.lifetime;
    case "path":
      return carrier.arguments.flatMap((argument) => argument.kind === "lifetime"
        ? [argument.value]
        : argument.kind === "type"
          ? [executionLifetime(argument.value)].filter((value): value is RustLifetimeRef =>
            value !== undefined)
          : [])[0];
    case "closure":
      return carrier.captures.find((capture) => capture.kind === "lifetime")?.value;
    case "opaque":
      return carrier.captures.find((capture) => capture.kind === "lifetime")?.value;
    default:
      return undefined;
  }
}

export function collectSuspensionPoints(
  callable: Node,
  flow: RustSourceFlowGraph,
  ast: AstReader,
): readonly RustSuspensionPoint[] {
  const points: RustSuspensionPoint[] = [];
  const visit = (node: Node): void => {
    if (node !== callable && isCallable(node, ast)) return;
    const kind = ast.kindName(node);
    if (kind === "KindAwaitExpression" || kind === "KindYieldExpression") {
      const occurrenceId = sourceNodeIdentity(ast, node);
      const point = flow.pointFor(node);
      if (occurrenceId !== undefined && point !== undefined) {
        points.push(Object.freeze({
          occurrenceId,
          kind: kind === "KindAwaitExpression" ? "await" : "yield",
          region: Object.freeze({
            id: `${occurrenceId}\0suspension`,
            kind: "suspension",
            parentId: point.regionId,
          }),
        }));
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  visit(callable);
  return Object.freeze(points);
}

export function captureCrossesSuspension(
  declaration: Node,
  callable: Node,
  suspensionPoints: readonly RustSuspensionPoint[],
  flow: RustSourceFlowGraph,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (suspensionPoints.length === 0) return false;
  const references = input.navigation.referencesToDeclaration(declaration).filter((reference) =>
    nodeContains(callable, reference, input));
  return suspensionPoints.some((suspension) => {
    const suspensionPoint = flow.points.find((point) => point.node !== undefined &&
      sourceNodeIdentity(input.ast, point.node) === suspension.occurrenceId);
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
  if (root === selected) return true;
  let found = false;
  input.ast.forEachChild(root, (child) => {
    if (!found && child !== undefined && nodeContains(child, selected, input)) found = true;
  });
  return found;
}

export function isCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

export function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    if (isCallable(current, ast)) return current;
    current = ast.parent(current);
  }
  return undefined;
}
