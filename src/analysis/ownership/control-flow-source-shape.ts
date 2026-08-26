import type { AstReader, Node } from "@tsonic/tsts";
import {
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import type { RustLexicalRegionIndex } from "./lexical-regions.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";
import { FlowShapeError } from "./control-flow-errors.js";
import type {
  RustSourceFlowEffects,
  RustSourceFlowPoint,
  RustSourceResourceCleanupEffect,
} from "./control-flow.js";

export function collectRustSourceCallables(root: Node, ast: AstReader): readonly Node[] {
  const callables: Node[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isRustSourceFlowCallable(node, ast)) callables.push(node);
    const children: Node[] = [];
    ast.forEachChild(node, (child) => {
      if (child !== undefined) children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
  return Object.freeze(callables);
}

export function rustSourceFlowNodePoint(
  node: Node,
  regionId: string,
  occurrence: number,
  ast: AstReader,
  lexicalRegions: RustLexicalRegionIndex,
  effects: RustSourceFlowEffects,
): Omit<RustSourceFlowPoint, "index"> {
  const occurrenceId = requireRustOwnershipSourceIdentity(ast, node);
  const suspensionKind = effects.nodeSuspensionKind(node);
  return Object.freeze({
    id: `${regionId}\0node:${occurrenceId}:${occurrence}`,
    regionId,
    lexicalRegionId: lexicalRegions.regionFor(node)?.id,
    node,
    kind: "node",
    ...(suspensionKind === undefined
      ? {}
      : { suspension: { kind: suspensionKind, occurrenceId } }),
  });
}

export function rustSourceFlowCleanupPoint(
  declaration: Node,
  effect: RustSourceResourceCleanupEffect,
  regionId: string,
  ordinal: number,
  ast: AstReader,
  lexicalRegions: RustLexicalRegionIndex,
): Omit<RustSourceFlowPoint, "index"> {
  const occurrenceId = requireRustOwnershipSourceIdentity(ast, declaration);
  return Object.freeze({
    id: `${regionId}\0resource-cleanup:${occurrenceId}:${ordinal}`,
    regionId,
    lexicalRegionId: lexicalRegions.regionFor(declaration)?.id,
    kind: "node",
    resourceCleanup: {
      declaration,
      access: effect.access,
    },
    ...(effect.asynchronous
      ? {
          suspension: {
            kind: "await" as const,
            occurrenceId: `${occurrenceId}\0resource-cleanup:${ordinal}`,
          },
        }
      : {}),
  });
}

export function rustSourceFlowDirectResourceDeclaration(
  statement: Node,
  ast: AstReader,
): Node {
  if (!ast.is.IsVariableStatement(statement)) {
    throw new FlowShapeError(
      "A lexical resource declaration must be represented by one exact variable statement.",
    );
  }
  const declarationList = requireRustSourceFlowNode(
    VariableStatement_DeclarationList(ast, statement),
    "Resource statement has no exact declaration list.",
  );
  const dense = rustSourceFlowDenseNodes(
    VariableDeclarationList_Declarations(ast, declarationList),
    "Resource statement contains an absent, undefined, or non-data declaration list.",
  );
  const [declaration] = dense;
  if (declaration === undefined || dense.length !== 1 ||
    !ast.is.IsVariableDeclaration(declaration)) {
    throw new FlowShapeError(
      "A lexical resource statement must contain exactly one variable declaration.",
    );
  }
  const declarationKind = ast.variableDeclarationKind(declaration);
  if (declarationKind !== "using" && declarationKind !== "await using") {
    throw new FlowShapeError(
      "Resource statement and declaration kinds do not identify the same exact resource binding.",
    );
  }
  return declaration;
}

export function rustSourceFlowResourceDeclarationForInitializer(
  initializer: Node,
  ast: AstReader,
): Node | undefined {
  const declarationKind = ast.variableDeclarationKind(initializer);
  if (declarationKind !== "using" && declarationKind !== "await using") return undefined;
  const declarations = ast.is.IsVariableDeclaration(initializer)
    ? [initializer]
    : ast.is.IsVariableDeclarationList(initializer)
      ? VariableDeclarationList_Declarations(ast, initializer)
      : undefined;
  const dense = rustSourceFlowDenseNodes(
    declarations,
    "Resource initializer contains an absent, undefined, or non-data declaration list.",
  );
  const [declaration] = dense;
  if (declaration === undefined || dense.length !== 1 ||
    !ast.is.IsVariableDeclaration(declaration) ||
    ast.variableDeclarationKind(declaration) !== declarationKind) {
    throw new FlowShapeError(
      "A resource initializer must contain exactly one matching variable declaration.",
    );
  }
  return declaration;
}

export function rustSourceFlowDenseStatements(node: Node, ast: AstReader): readonly Node[] {
  return rustSourceFlowDenseNodes(
    ast.statements(node),
    "Statement list contains an undefined or non-data statement slot.",
  );
}

export function rustSourceFlowDenseNodes(
  values: readonly (Node | undefined)[] | undefined,
  message: string,
): readonly Node[] {
  if (values === undefined || !isDenseDataArray(values) ||
    values.some((value) => value === undefined)) {
    throw new FlowShapeError(message);
  }
  return values as readonly Node[];
}

export function requireRustSourceFlowNode(node: Node | undefined, message: string): Node {
  if (node === undefined) throw new FlowShapeError(message);
  return node;
}

export function isRustSourceFlowCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}

export function isRustSourceFlowIterationKind(kind: string): boolean {
  return kind === "KindWhileStatement" || kind === "KindDoStatement" ||
    kind === "KindForStatement" || kind === "KindForInStatement" ||
    kind === "KindForOfStatement";
}

export function isRustSourceFlowShortCircuitOperator(kind: string | undefined): boolean {
  return kind === "KindAmpersandAmpersandToken" || kind === "KindBarBarToken" ||
    kind === "KindQuestionQuestionToken";
}
