import {
  ExtensionLifecycleEvent,
  argumentPassingFactKey,
  flowStateFactKey,
  functionPointerFactKey,
  pointerFactKey,
  providerVirtualDeclarationFactKey,
  runtimeCarrierFactKey,
  selectedTargetSignatureFactKey,
  sourcePrimitiveFactKey,
  targetOperationFactKey,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionLifecycleContext,
  Node,
  ProviderDeclarationIdentity,
  SourceFile,
  TargetMember,
  TargetTypeRef,
} from "@tsonic/tsts";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core";
import type { TargetProviderContext } from "@tsonic/target-api";
import {
  ArrayTypeNode_ElementType,
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  CatchClause_Block,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  TryStatement_CatchClause,
  TryStatement_TryBlock,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  Node_Operand,
  TypeOperatorNode_Type,
  TypeReferenceNode_TypeName,
  KindBinaryExpression,
  KindBlock,
  KindBooleanKeyword,
  KindCallExpression,
  KindElementAccessExpression,
  KindEqualsToken,
  KindExpressionStatement,
  KindFalseKeyword,
  KindForOfStatement,
  KindForStatement,
  KindFunctionDeclaration,
  KindIdentifier,
  KindIfStatement,
  KindArrayLiteralExpression,
  KindArrayType,
  KindInterfaceDeclaration,
  KindNewExpression,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringKeyword,
  KindStringLiteral,
  KindTypeReference,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  KindVoidKeyword,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  getPostfixUnaryOperatorText,
  getPrefixUnaryOperatorText,
} from "../../common/source-ast.js";
import {
  isRustBoolCarrier,
  rustOptionTargetType,
  isRustIntegerCarrier,
  isRustJsArrayCarrier,
  rustFutureOutputCarrier,
  rustFutureTargetType,
  rustSliceElementCarrier,
  rustSliceMutRefTargetType,
  rustSliceRefTargetType,
  isRustNumericCarrier,
  isRustOptionCarrier,
  isRustSignedNumericCarrier,
  isRustVecCarrier,
  rustJsArrayTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
  rustVecTargetType,
} from "../rust-target-types.js";
import { rustAsyncFunctionFactKey, rustExtensionId, rustFallibleCallFactKey, rustFallibleFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustOptionWrapFactKey, rustSelfModeFactKey, rustSourceTypeCarrier, rustTargetOperationFactKey, rustUnionVariantsFactKey } from "../rust-facts/keys.js";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import { collectRustProviderOperationRows } from "../provider-packages/index.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import { rustOperatorCarrierKey, selectRustBinaryOperator, selectRustCompoundAssignment } from "./operator-rules.js";
import { jsOperationMayBeFallible, selectJsSurfaceConstructor, selectJsSurfaceOperation } from "./js-surface-operations.js";
import type { JsOperationSelection } from "./js-surface-operations.js";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.target-semantics";

export function createRustTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  const providerRows = collectRustProviderOperationRows(context.selectedPackages);
  const jsEnabled = context.selectedSurfaces.some((surface) => surface.id === "js") ||
    readRustTypescriptCompatibilityMode(context.target) === "compat";
  return {
    identity: {
      id: rustTargetSemanticsExtensionId,
      version: "0.0.1",
      capabilityNamespace: rustExtensionId,
    },
    dependencies: {
      dependsOn: [tsonicCoreSourceExtensionId],
      runsAfter: [tsonicCoreSourceExtensionId],
    },
    composition: { kind: "target", target: "rust" },
    initialize(extensionContext): void {
      extensionContext.registerLifecycleHook(
        ExtensionLifecycleEvent.beforeSemanticsFinalized,
        (_request, lifecycleContext) => {
          recordRustFactsBeforeFinalization(lifecycleContext, providerRows, jsEnabled);
        },
      );
    },
  };
}

interface RustFactWalk {
  readonly lifecycle: ExtensionLifecycleContext;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly resolving: Set<object>;
  readonly jsEnabled: boolean;
  currentThisCarrier?: TargetTypeRef;
  currentMethodDeclaration?: Node;
  readonly sourceTypeDeclarations: Map<string, Node>;
  readonly unionAliasVariants: Map<string, readonly { readonly name: string; readonly literal: string }[]>;
}

const boolCarrier = rustSourcePrimitiveTargetType("bool");

export function recordRustFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly RustProviderOperationRow[],
  jsEnabled = false,
): void {
  const walk: RustFactWalk = { lifecycle, providerRows, resolving: new Set(), jsEnabled, sourceTypeDeclarations: new Map(), unionAliasVariants: new Map() };
  const { ast } = lifecycle.compiler;
  // Pass 0: register every project type declaration so contextual record
  // binding works regardless of file order.
  for (const sourceFile of lifecycle.compiler.getSourceFiles()) {
    if (sourceFile === undefined || ast.getFileName(sourceFile).endsWith(".d.ts")) {
      continue;
    }
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      const kind = ast.kindName(statement);
      if (kind === "KindInterfaceDeclaration") {
        recordInterfaceFacts(walk, statement);
      } else if (kind === "KindClassDeclaration" || kind === "KindEnumDeclaration") {
        const carrier = sourceTypeCarrierForDeclaration(walk, statement);
        if (carrier !== undefined) {
          registerSourceTypeDeclaration(walk, carrier, statement);
        }
      } else if (kind === "KindTypeAliasDeclaration") {
        registerUnionAlias(walk, statement);
      }
    }
  }
  recordFallibilityFacts(walk);
  for (const sourceFile of lifecycle.compiler.getSourceFiles()) {
    if (sourceFile === undefined) {
      continue;
    }
    const fileName = ast.getFileName(sourceFile);
    if (fileName.endsWith(".d.ts")) {
      continue;
    }
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionFacts(walk, statement, sourceFile);
      } else if (kind === KindVariableStatement) {
        recordVariableStatementFacts(walk, statement, sourceFile);
      } else if (kind === "KindClassDeclaration") {
        recordClassFacts(walk, statement, sourceFile);
      } else if (kind === "KindEnumDeclaration") {
        recordEnumFacts(walk, statement, sourceFile);
      }
    }
  }
}

function promiseInnerCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const { ast, checker } = walk.lifecycle.compiler;
  if (ast.kindName(typeNode) !== KindTypeReference) {
    return undefined;
  }
  const nameNode = TypeReferenceNode_TypeName(typeNode) ?? typeNode;
  const symbol = checker.getSymbolAtLocation(nameNode) ?? checker.getResolvedSymbolOrNil(nameNode);
  if (symbol === undefined || checker.getSymbolName(symbol) !== "Promise") {
    return undefined;
  }
  const isLibDeclaration = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined && ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts"));
  if (!isLibDeclaration) {
    return undefined;
  }
  const [argument] = ast.typeArguments(typeNode);
  return argument === undefined ? undefined : resolveTypeNodeCarrier(walk, argument);
}

function recordFunctionFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  let returnCarrier: TargetTypeRef | undefined;
  if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(walk, Node_Type(declaration));
    if (inner !== undefined) {
      returnCarrier = inner;
      walk.lifecycle.host.facts.set(declaration, rustAsyncFunctionFactKey, { isAsync: true }, [
        { message: "rust async function" },
      ]);
      const typeNode = Node_Type(declaration);
      if (typeNode !== undefined) {
        setCarrierFact(walk, typeNode, inner);
      }
    }
  } else {
    returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  }
  for (const parameter of ast.parameters(declaration)) {
    if (parameter === undefined) {
      continue;
    }
    const parameterCarrier = parameterLaneCarrier(walk, resolveTypeNodeCarrier(walk, Node_Type(parameter)));
    if (parameterCarrier !== undefined) {
      setCarrierFact(walk, parameter, parameterCarrier);
    }
  }
  const body = ast.body(declaration);
  if (body !== undefined) {
    for (const statement of ast.statements(body)) {
      if (statement !== undefined) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    }
  }
}

function recordVariableStatementFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  for (const declaration of collectDescendantsOfKind(walk, statement, KindVariableDeclaration)) {
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
    const initializer = Node_Initializer(declaration);
    const initializerCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, annotated);
    const effective = annotated ?? initializerCarrier;
    if (effective !== undefined) {
      setCarrierFact(walk, declaration, effective);
    }
  }
}

function recordStatementFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(statement);
  if (kind === KindBlock) {
    for (const child of ast.statements(statement)) {
      if (child !== undefined) {
        recordStatementFacts(walk, child, sourceFile, returnCarrier);
      }
    }
    return;
  }
  if (kind === KindVariableStatement) {
    recordVariableStatementFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindReturnStatement) {
    const expression = Node_Expression(statement);
    if (expression !== undefined) {
      resolveExpressionCarrier(walk, expression, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindExpressionStatement) {
    const expression = Node_Expression(statement);
    if (expression === undefined) {
      return;
    }
    if (ast.kindName(expression) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(expression);
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (operatorKind === KindEqualsToken) {
        const left = BinaryExpression_Left(expression);
        const right = BinaryExpression_Right(expression);
        recordBindingWrite(walk, left);
        if (left !== undefined && right !== undefined && recordJsAssignmentFacts(walk, expression, left, right, sourceFile)) {
          return;
        }
        const leftCarrier = left === undefined
          ? undefined
          : resolveExpressionCarrier(walk, left, sourceFile, undefined);
        if (right !== undefined) {
          resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        }
        return;
      }
      const left = BinaryExpression_Left(expression);
      const right = BinaryExpression_Right(expression);
      if (left !== undefined && right !== undefined) {
        const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
        const rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        const compound = selectRustCompoundAssignment(operatorKind, leftCarrier, rightCarrier);
        if (compound !== undefined && leftCarrier !== undefined) {
          recordBindingWrite(walk, left);
          recordOperatorFacts(walk, expression, compound, leftCarrier, rustOperatorCarrierKey(leftCarrier));
          return;
        }
      }
    }
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    return;
  }
  if (kind === "KindThrowStatement") {
    recordThrowFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === "KindTryStatement") {
    const tryBlock = TryStatement_TryBlock(statement);
    if (tryBlock !== undefined) {
      recordStatementFacts(walk, tryBlock, sourceFile, returnCarrier);
    }
    const catchBlock = CatchClause_Block(TryStatement_CatchClause(statement));
    if (catchBlock !== undefined) {
      recordStatementFacts(walk, catchBlock, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindIfStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const thenStatement = IfStatement_ThenStatement(statement);
    if (thenStatement !== undefined) {
      recordStatementFacts(walk, thenStatement, sourceFile, returnCarrier);
    }
    const elseStatement = IfStatement_ElseStatement(statement);
    if (elseStatement !== undefined) {
      recordStatementFacts(walk, elseStatement, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindWhileStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = IterationStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindForOfStatement) {
    recordForOfFacts(walk, statement, sourceFile, returnCarrier);
    return;
  }
  if (kind === KindForStatement) {
    const initializer = ForStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
        const declarationInitializer = Node_Initializer(declaration);
        const initializerCarrier = declarationInitializer === undefined
          ? undefined
          : resolveExpressionCarrier(walk, declarationInitializer, sourceFile, annotated);
        const effective = annotated ?? initializerCarrier;
        if (effective !== undefined) {
          setCarrierFact(walk, declaration, effective);
        }
      }
    }
    const condition = ForStatement_Condition(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const incrementor = ForStatement_Incrementor(statement);
    if (incrementor !== undefined) {
      resolveExpressionCarrier(walk, incrementor, sourceFile, undefined);
    }
    const body = IterationStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}



function resolveTypeNodeCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(typeNode, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (facts.get(typeNode, pointerFactKey) !== undefined || facts.get(typeNode, functionPointerFactKey) !== undefined) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_SOURCE_MARKER_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: "ptr/fnptr type markers have no Rust target lane yet; they require the unsafe boundary contract.",
      evidence: [{ message: "target.capability=rust.source.type-marker" }],
    });
    return undefined;
  }
  const primitive = facts.get(typeNode, sourcePrimitiveFactKey);
  if (primitive !== undefined) {
    return setCarrierFact(walk, typeNode, rustSourcePrimitiveTargetType(primitive.kind));
  }
  const kind = walk.lifecycle.compiler.ast.kindName(typeNode);
  if (kind === KindTypeReference) {
    const nameNode = TypeReferenceNode_TypeName(typeNode) ?? typeNode;
    const declaration = projectDeclarationFor(walk, nameNode);
    if (declaration !== undefined && walk.lifecycle.compiler.ast.kindName(declaration) === "KindTypeParameter") {
      const parameterName = walk.lifecycle.compiler.ast.text(walk.lifecycle.compiler.ast.name(declaration) ?? declaration);
      return setCarrierFact(walk, typeNode, { kind: "type-parameter", name: parameterName });
    }
    const sourceType = sourceTypeCarrierForReference(walk, typeNode);
    if (sourceType !== undefined) {
      return setCarrierFact(walk, typeNode, sourceType);
    }
  }
  if (kind === KindArrayType) {
    const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(typeNode));
    return element === undefined ? undefined : setCarrierFact(walk, typeNode, rustVecTargetType(element));
  }
  if (kind === "KindTupleType") {
    const elementNodes = walk.lifecycle.compiler.ast.children(typeNode)
      .filter((child): child is Node => child !== undefined)
      .flatMap((child) => walk.lifecycle.compiler.ast.kindName(child) === "KindSyntaxList"
        ? walk.lifecycle.compiler.ast.children(child).filter((entry): entry is Node => entry !== undefined)
        : [child])
      .filter((child) => !walk.lifecycle.compiler.ast.kindName(child).endsWith("Token"));
    if (elementNodes.length === 0) {
      return undefined;
    }
    const elements: TargetTypeRef[] = [];
    for (const elementNode of elementNodes) {
      const element = resolveTypeNodeCarrier(walk, elementNode);
      if (element === undefined) {
        return undefined;
      }
      elements.push(element);
    }
    return setCarrierFact(walk, typeNode, { kind: "tuple", elements });
  }
  if (kind === "KindUnionType") {
    const childTypes = walk.lifecycle.compiler.ast.children(typeNode)
      .filter((child): child is Node => child !== undefined)
      .flatMap((child) => walk.lifecycle.compiler.ast.kindName(child) === "KindSyntaxList"
        ? walk.lifecycle.compiler.ast.children(child).filter((entry): entry is Node => entry !== undefined)
        : [child]);
    const typeMembers = childTypes.filter((child) => {
      const childKind = walk.lifecycle.compiler.ast.kindName(child);
      return childKind !== "KindBarToken";
    });
    if (typeMembers.length === 2) {
      const isNullMember = (member: Node): boolean => {
        const memberKind = walk.lifecycle.compiler.ast.kindName(member);
        if (memberKind !== "KindLiteralType") {
          return false;
        }
        const literal = walk.lifecycle.compiler.ast.children(member)[0];
        return literal !== undefined && walk.lifecycle.compiler.ast.kindName(literal) === "KindNullKeyword";
      };
      // `T | undefined` is a JS-surface concept: the Option lane for it is
      // enabled only with the js surface or compat mode.
      const isUndefinedMember = (member: Node): boolean =>
        walk.lifecycle.compiler.ast.kindName(member) === "KindUndefinedKeyword";
      const nullishMember = typeMembers.find((member) =>
        isNullMember(member) || (walk.jsEnabled && isUndefinedMember(member)));
      const valueMember = typeMembers.find((member) => !isNullMember(member) && !isUndefinedMember(member));
      if (nullishMember !== undefined && valueMember !== undefined) {
        const inner = resolveTypeNodeCarrier(walk, valueMember);
        if (inner !== undefined) {
          return setCarrierFact(walk, typeNode, rustOptionTargetType(inner));
        }
      }
    }
    return undefined;
  }
  if (kind === "KindTypeOperator") {
    // `readonly T[]` lowers to a borrowed slice lane.
    const inner = TypeOperatorNode_Type(typeNode);
    if (inner !== undefined && walk.lifecycle.compiler.ast.kindName(inner) === KindArrayType) {
      const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(inner));
      return element === undefined ? undefined : setCarrierFact(walk, typeNode, rustSliceRefTargetType(element));
    }
    return undefined;
  }
  if (kind === KindStringKeyword) {
    return setCarrierFact(walk, typeNode, rustStringTargetType());
  }
  if (kind === "KindNumberKeyword") {
    return setCarrierFact(walk, typeNode, rustSourcePrimitiveTargetType("float64"));
  }
  if (kind === KindBooleanKeyword) {
    return setCarrierFact(walk, typeNode, boolCarrier);
  }
  if (kind === KindVoidKeyword) {
    return setCarrierFact(walk, typeNode, rustUnitTargetType());
  }
  return undefined;
}

function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(expression, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (walk.resolving.has(expression)) {
    return undefined;
  }
  walk.resolving.add(expression);
  try {
    const resolved = resolveExpressionCarrierUncached(walk, expression, sourceFile, expected);
    return applyOptionLane(walk, expression, resolved, expected);
  } finally {
    walk.resolving.delete(expression);
  }
}

// Nullish lane: values flow into Option<T> positions through explicit
// Some-wrapping facts; null literals become None.
function applyOptionLane(
  walk: RustFactWalk,
  expression: Node,
  resolved: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return resolved;
  }
  const inner = expected.kind === "target-named" ? expected.typeArguments?.[0] : undefined;
  if (inner === undefined) {
    return resolved;
  }
  const existing = walk.lifecycle.host.facts.get(expression, rustTargetOperationFactKey);
  if (resolved !== undefined && isRustOptionCarrier(resolved)) {
    return resolved;
  }
  const { ast, checker, typeShape } = walk.lifecycle.compiler;
  if (ast.kindName(expression) === "KindNullKeyword") {
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    return expected;
  }
  if (walk.jsEnabled && ast.kindName(expression) === KindIdentifier) {
    const type = checker.getTypeAtLocation(expression);
    if (type !== undefined && typeShape.isVoidLike(type) && ast.text(expression) === "undefined") {
      if (existing === undefined) {
        setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
      }
      return expected;
    }
  }
  if (resolved !== undefined && JSON.stringify(resolved) === JSON.stringify(inner)) {
    if (existing === undefined || existing.kind === "operator-token" || existing.kind === "provider-operation" || existing.kind === "source-field" || existing.kind === "source-method") {
      walk.lifecycle.host.facts.set(expression, rustOptionWrapFactKey, { wrap: true }, [{ message: "rust option wrap" }]);
    }
    return expected;
  }
  return resolved;
}

function resolveExpressionCarrierUncached(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const kind = walk.lifecycle.compiler.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      const effectiveExpected = expected !== undefined && isRustOptionCarrier(expected) && expected.kind === "target-named"
        ? expected.typeArguments?.[0]
        : expected;
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected)) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      return undefined;
    }
    case KindStringLiteral: {
      if (expected !== undefined) {
        const value = rustSourceTypeCarrierValueLocal(expected);
        if (value !== undefined && value.shape === "enum") {
          const variants = walk.unionAliasVariants.get(`${value.fileName}::${value.typeName}`);
          const literal = walk.lifecycle.compiler.ast.text(expression);
          const variant = variants?.find((candidate) => candidate.literal === literal);
          if (variant !== undefined) {
            setRustOperationFact(walk, expression, {
              kind: "source-enum-member",
              operationId: `tsonic.rust.union.variant:${variant.name}`,
              name: variant.name,
              resultCarrier: expected,
            });
            return setCarrierFact(walk, expression, expected);
          }
        }
      }
      return setCarrierFact(walk, expression, rustStringTargetType());
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      const thisCarrier = walk.currentThisCarrier;
      return thisCarrier === undefined ? undefined : setCarrierFact(walk, expression, thisCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindArrayLiteralExpression: {
      return resolveArrayLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case "KindObjectLiteralExpression": {
      return resolveRecordLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case "KindArrowFunction": {
      return resolveArrowFunctionCarrier(walk, expression, sourceFile, expected);
    }
    case "KindAwaitExpression": {
      const operand = Node_Expression(expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      const output = rustFutureOutputCarrier(operandCarrier);
      if (output === undefined) {
        return undefined;
      }
      const operandFallible = operand !== undefined &&
        walk.lifecycle.host.facts.get(operand, rustFallibleCallFactKey) !== undefined;
      setRustOperationFact(walk, expression, {
        kind: "await-op",
        operationId: "tsonic.rust.async.await",
        resultCarrier: output,
        ...(operandFallible ? { fallible: true } : {}),
      });
      return setCarrierFact(walk, expression, output);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return resolveUnaryCarrier(walk, expression, sourceFile, expected, kind);
    }
    case KindBinaryExpression: {
      return resolveBinaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindCallExpression:
    case KindNewExpression: {
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind, expected);
    }
    case KindPropertyAccessExpression: {
      return resolveProviderMemberCarrier(walk, expression, sourceFile, "property");
    }
    case KindElementAccessExpression: {
      return resolveProviderIndexerCarrier(walk, expression, sourceFile);
    }
    default: {
      return undefined;
    }
  }
}

function resolveIdentifierCarrier(walk: RustFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { checker } = walk.lifecycle.compiler;
  const symbol = checker.getResolvedSymbolOrNil(identifier) ?? checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return undefined;
  }
  const declaration = checker.getSymbolValueDeclaration(symbol) ?? checker.getPrimarySymbolDeclaration(symbol);
  if (declaration === undefined) {
    return undefined;
  }
  const declarationKind = walk.lifecycle.compiler.ast.kindName(declaration);
  if (declarationKind !== KindParameter && declarationKind !== KindVariableDeclaration) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const declarationFact = facts.get(declaration, runtimeCarrierFactKey);
  if (declarationFact !== undefined) {
    return setCarrierFact(walk, identifier, declarationFact.carrier);
  }
  const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  if (annotated !== undefined) {
    setCarrierFact(walk, declaration, annotated);
    return setCarrierFact(walk, identifier, annotated);
  }
  const initializer = Node_Initializer(declaration);
  if (initializer !== undefined) {
    const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
    if (initializerCarrier !== undefined) {
      setCarrierFact(walk, declaration, initializerCarrier);
      return setCarrierFact(walk, identifier, initializerCarrier);
    }
  }
  return undefined;
}

function resolveUnaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  expressionKind: string,
): TargetTypeRef | undefined {
  const operand = Node_Operand(expression);
  if (operand === undefined) {
    return undefined;
  }
  const ast = walk.lifecycle.compiler.ast;
  const operatorText = expressionKind === KindPrefixUnaryExpression
    ? getPrefixUnaryOperatorText(ast, expression)
    : getPostfixUnaryOperatorText(ast, expression);
  if (operatorText === "!" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, boolCarrier);
    if (operandCarrier !== undefined && isRustBoolCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "!", boolCarrier, rustOperatorCarrierKey(boolCarrier));
      return setCarrierFact(walk, expression, boolCarrier);
    }
    return undefined;
  }
  if (operatorText === "-" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, expected);
    if (operandCarrier !== undefined && isRustSignedNumericCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "-", operandCarrier, rustOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  if (operatorText === "++" || operatorText === "--") {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    if (operandCarrier !== undefined && isRustIntegerCarrier(operandCarrier)) {
      recordBindingWrite(walk, operand);
      const operator = operatorText === "++" ? "+=" : "-=";
      recordOperatorFacts(walk, expression, operator, operandCarrier, rustOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  return undefined;
}

function resolveBinaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const left = BinaryExpression_Left(expression);
  const right = BinaryExpression_Right(expression);
  const ast = walk.lifecycle.compiler.ast;
  const operatorToken = BinaryExpression_OperatorToken(expression);
  if (left === undefined || right === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = ast.kindName(operatorToken);
  if (operatorKind === KindEqualsToken) {
    return undefined;
  }
  const equalityOperator = operatorKind === "KindEqualsEqualsEqualsToken" || operatorKind === "KindExclamationEqualsEqualsToken";
  if (equalityOperator) {
    const optionCheck = tryRecordOptionUndefinedCheck(walk, expression, left, right, sourceFile, operatorKind === "KindExclamationEqualsEqualsToken");
    if (optionCheck !== undefined) {
      return optionCheck;
    }
  }
  const unionPeerCarrier = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => {
    const value = carrier === undefined ? undefined : rustSourceTypeCarrierValueLocal(carrier);
    return value !== undefined && value.shape === "enum" ? carrier : undefined;
  };
  let leftCarrier: TargetTypeRef | undefined;
  let rightCarrier: TargetTypeRef | undefined;
  if (equalityOperator && ast.kindName(right) === KindStringLiteral && ast.kindName(left) !== KindStringLiteral) {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, unionPeerCarrier(leftCarrier));
  } else if (equalityOperator && ast.kindName(left) === KindStringLiteral && ast.kindName(right) !== KindStringLiteral) {
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, undefined);
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, unionPeerCarrier(rightCarrier));
  } else {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, undefined);
  }
  if (leftCarrier === undefined && rightCarrier !== undefined && isRustNumericCarrier(rightCarrier)) {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, rightCarrier);
  }
  if (rightCarrier === undefined && leftCarrier !== undefined && isRustNumericCarrier(leftCarrier)) {
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
  }
  if (expected !== undefined && isRustNumericCarrier(expected)) {
    if (leftCarrier === undefined) {
      leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, expected);
    }
    if (rightCarrier === undefined) {
      rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, expected);
    }
  }
  if (equalityOperator && leftCarrier === undefined && rightCarrier === undefined) {
    // Equality between context-free numeric expressions defaults to float64:
    // TypeScript numbers are IEEE doubles.
    const doubleCarrier = rustSourcePrimitiveTargetType("float64");
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, doubleCarrier);
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, doubleCarrier);
  }
  if (operatorKind === "KindQuestionQuestionToken") {
    const rebindLeft = leftCarrier !== undefined && isRustOptionCarrier(leftCarrier) ? leftCarrier : undefined;
    const inner = rebindLeft?.kind === "target-named" ? rebindLeft.typeArguments?.[0] : undefined;
    if (rebindLeft === undefined || inner === undefined || right === undefined) {
      return undefined;
    }
    const coalesceRight = resolveExpressionCarrier(walk, right, sourceFile, inner);
    if (coalesceRight === undefined || JSON.stringify(coalesceRight) !== JSON.stringify(inner)) {
      return undefined;
    }
    setRustOperationFact(walk, expression, { kind: "option-coalesce", operationId: "tsonic.rust.option.coalesce" });
    recordTargetOperation(walk, expression, "tsonic.rust.option.coalesce", "operator", "unwrap_or");
    return setCarrierFact(walk, expression, inner);
  }
  const selection = selectRustBinaryOperator(operatorKind, leftCarrier, rightCarrier);
  if (selection === undefined || leftCarrier === undefined) {
    return undefined;
  }
  if (selection.kind === "string-concat") {
    const operationId = "tsonic.rust.operator.concat.string";
    recordTargetOperation(walk, expression, operationId, "operator", "concat");
    setRustOperationFact(walk, expression, {
      kind: "string-concat",
      operationId,
      resultCarrier: selection.resultCarrier,
    });
  } else {
    recordOperatorFacts(walk, expression, selection.rustOperator, selection.resultCarrier, rustOperatorCarrierKey(leftCarrier));
  }
  return setCarrierFact(walk, expression, selection.resultCarrier);
}

function resolveCallLikeCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
  expected?: TargetTypeRef,
): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const callee = Node_Expression(expression);
  if (callee === undefined) {
    return undefined;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const providerIdentity = providerDeclarationIdentityFor(walk, callee);
  if (providerIdentity !== undefined) {
    const operationKind = expressionKind === KindNewExpression ? "constructor" : "method";
    const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
    if (row === undefined) {
      appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
      return undefined;
    }
    for (const [index, argument] of callArguments.entries()) {
      if (argument !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
        validateFlowMarkerAgainstMode(walk, argument, rowArgumentMode(row, index));
        if (rowArgumentMode(row, index) === "mut-ref") {
          recordBindingWrite(walk, argument, "referent");
        }
      }
    }
    if (row.target.form === "receiver-method" && row.target.mutatesReceiver === true && ast.kindName(callee) === KindPropertyAccessExpression) {
      recordBindingWrite(walk, Node_Expression(callee), "referent");
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    if (row.isAsync === true) {
      if (row.isFallible === true) {
        // Async fallibility surfaces at the await site: call().await?.
        walk.lifecycle.host.facts.set(expression, rustFallibleCallFactKey, { fallible: true }, [
          { message: "rust fallible async call" },
        ]);
      }
      return setCarrierFact(walk, expression, rustFutureTargetType(row.resultCarrier));
    }
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  const sourceCallLike = trySourceCallLike(walk, expression, callee, callArguments, sourceFile, expressionKind);
  if (sourceCallLike !== undefined) {
    return sourceCallLike;
  }
  if (walk.jsEnabled) {
    const jsSelection = expressionKind === KindNewExpression
      ? selectJsConstructorForNode(walk, expression, callee, callArguments, sourceFile)
      : selectJsCallForNode(walk, expression, callee, callArguments, sourceFile);
    if (jsSelection !== undefined) {
      return applyJsSelection(walk, expression, jsSelection, sourceFile, callArguments);
    }
  }
  if (expressionKind === KindNewExpression) {
    return undefined;
  }
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration === undefined || ast.kindName(declaration) !== KindFunctionDeclaration) {
    return undefined;
  }
  const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
  if (declarationFile.endsWith(".d.ts")) {
    return undefined;
  }
  if (walk.lifecycle.host.facts.get(declaration, rustFallibleFactKey) !== undefined) {
    walk.lifecycle.host.facts.set(expression, rustFallibleCallFactKey, { fallible: true }, [
      { message: "rust fallible call" },
    ]);
  }
  const parameters = ast.parameters(declaration);
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      continue;
    }
    const parameter = parameters[index];
    const parameterCarrier = parameter === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
        parameterLaneCarrier(walk, resolveTypeNodeCarrier(walk, Node_Type(parameter)));
    resolveExpressionCarrier(walk, argument, sourceFile, parameterCarrier);
    if (parameterCarrier?.kind === "pointer" && parameterCarrier.mutability === "mut") {
      recordBindingWrite(walk, argument, "referent");
    }
  }
  let returnCarrier: TargetTypeRef | undefined;
  if (ast.hasModifierKind(declaration, "async")) {
    const inner = walk.lifecycle.host.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined
      ? walk.lifecycle.host.facts.get(Node_Type(declaration) ?? declaration, runtimeCarrierFactKey)?.carrier
      : promiseInnerCarrier(walk, Node_Type(declaration));
    if (inner === undefined) {
      return undefined;
    }
    returnCarrier = rustFutureTargetType(inner);
  } else {
    returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  }
  if (returnCarrier?.kind === "type-parameter") {
    // Passthrough generic instantiation: the return carrier is the carrier of
    // the argument bound to the same type parameter position.
    const parameterIndex = parameters.findIndex((parameter) => {
      const parameterCarrier = parameter === undefined
        ? undefined
        : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(parameter));
      return parameterCarrier?.kind === "type-parameter" && parameterCarrier.name === (returnCarrier as { name: string }).name;
    });
    const boundArgument = parameterIndex >= 0 ? callArguments[parameterIndex] : undefined;
    let argumentCarrier = boundArgument === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(boundArgument, runtimeCarrierFactKey)?.carrier;
    if (argumentCarrier === undefined && boundArgument !== undefined && expected !== undefined) {
      argumentCarrier = resolveExpressionCarrier(walk, boundArgument, sourceFile, expected);
    }
    returnCarrier = argumentCarrier ?? returnCarrier;
    if (returnCarrier.kind === "type-parameter") {
      return undefined;
    }
  }
  return returnCarrier === undefined ? undefined : setCarrierFact(walk, expression, returnCarrier);
}

function resolveProviderMemberCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  operationKind: "property",
): TargetTypeRef | undefined {
  const receiver = Node_Expression(expression);
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  const providerIdentity = providerDeclarationIdentityFor(walk, expression);
  if (providerIdentity === undefined) {
    const sourceMember = trySourceMemberAccess(walk, expression, receiver, sourceFile);
    if (sourceMember !== undefined) {
      return sourceMember;
    }
    if (walk.jsEnabled && receiver !== undefined) {
      const identity = libMemberIdentityFor(walk, expression);
      if (identity !== undefined) {
        const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        const selection = selectJsSurfaceOperation({
          ownerName: identity.ownerName,
          memberName: identity.memberName,
          operationKind: "property",
          ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
        });
        if (selection !== undefined) {
          return applyJsSelection(walk, expression, selection, sourceFile, []);
        }
      }
    }
    return undefined;
  }
  const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
  if (row === undefined) {
    appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
    return undefined;
  }
  recordProviderOperationFacts(walk, expression, row, providerIdentity);
  return setCarrierFact(walk, expression, row.resultCarrier);
}

function resolveProviderIndexerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const receiver = Node_Expression(expression);
  if (receiver === undefined) {
    return undefined;
  }
  const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  if (receiverCarrier?.kind === "tuple" && receiverCarrier.elements.length > 0) {
    const argument = ElementAccessExpression_ArgumentExpression(expression);
    const indexText = argument === undefined || ast.kindName(argument) !== KindNumericLiteral ? undefined : ast.text(argument);
    const index = indexText === undefined ? undefined : Number.parseInt(indexText, 10);
    const element = index === undefined ? undefined : receiverCarrier.elements[index];
    if (element === undefined) {
      return undefined;
    }
    setRustOperationFact(walk, expression, {
      kind: "tuple-index",
      operationId: `tsonic.rust.tuple.index.${index}`,
      index: index!,
      resultCarrier: element,
    });
    return setCarrierFact(walk, expression, element);
  }
  if (receiverCarrier !== undefined && receiverCarrier.kind !== "target-named" && walk.jsEnabled) {
    const selection = selectJsSurfaceOperation({
      ownerName: "Array",
      memberName: "index",
      operationKind: "indexer",
      receiverCarrier,
    });
    if (selection !== undefined) {
      const argument = ElementAccessExpression_ArgumentExpression(expression);
      applyJsSelection(walk, expression, selection, sourceFile, argument === undefined ? [] : [argument]);
      return selection.resultCarrier;
    }
  }
  if (receiverCarrier?.kind !== "target-named") {
    return undefined;
  }
  const row = walk.providerRows.find((candidate) =>
    candidate.operationKind === "indexer" &&
    candidate.receiverTypeId === receiverCarrier.id);
  if (row === undefined) {
    if (walk.jsEnabled) {
      const selection = selectJsSurfaceOperation({
        ownerName: "Array",
        memberName: "index",
        operationKind: "indexer",
        receiverCarrier,
      });
      if (selection !== undefined) {
        const argument = ElementAccessExpression_ArgumentExpression(expression);
        applyJsSelection(walk, expression, selection, sourceFile, argument === undefined ? [] : [argument]);
        return selection.resultCarrier;
      }
    }
    return undefined;
  }
  const argument = ElementAccessExpression_ArgumentExpression(expression);
  if (argument !== undefined) {
    resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[0]);
  }
  void ast;
  recordProviderOperationFacts(walk, expression, row, undefined);
  return setCarrierFact(walk, expression, row.resultCarrier);
}

function safeAliasedSymbol(
  checker: RustFactWalk["lifecycle"]["compiler"]["checker"],
  symbol: NonNullable<ReturnType<RustFactWalk["lifecycle"]["compiler"]["checker"]["getSymbolAtLocation"]>>,
) {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return undefined;
  }
}

function providerDeclarationIdentityFor(walk: RustFactWalk, reference: Node): ProviderDeclarationIdentity | undefined {
  const { checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const candidate of [symbol, safeAliasedSymbol(checker, symbol)]) {
    if (candidate === undefined) {
      continue;
    }
    for (const declaration of checker.getSymbolDeclarations(candidate)) {
      if (declaration === undefined) {
        continue;
      }
      const fact = facts.get(declaration, providerVirtualDeclarationFactKey);
      if (fact !== undefined) {
        return fact as ProviderDeclarationIdentity;
      }
    }
  }
  return undefined;
}

function matchProviderRow(
  rows: readonly RustProviderOperationRow[],
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderOperationRow["operationKind"],
): RustProviderOperationRow | undefined {
  return rows.find((row) => {
    if (row.operationKind !== operationKind) {
      return false;
    }
    if (row.memberId !== undefined) {
      return row.memberId === identity.memberId;
    }
    if (row.exportId !== identity.exportId) {
      return false;
    }
    return row.signatureId === undefined || row.signatureId === identity.signatureId;
  });
}

function recordProviderOperationFacts(
  walk: RustFactWalk,
  expression: Node,
  row: RustProviderOperationRow,
  identity: ProviderDeclarationIdentity | undefined,
): void {
  const operationId = row.memberId ?? row.signatureId ?? row.exportId;
  const targetOperationText = row.target.form === "call" || row.target.form === "path" || row.target.form === "free-call" || row.target.form === "call-str-slice"
    ? row.target.path
    : row.target.form === "index"
      ? "[]"
      : row.target.form === "binary-operator"
        ? row.target.operator
        : row.target.name;
  recordTargetOperation(walk, expression, operationId, row.operationKind, targetOperationText);
  setRustOperationFact(walk, expression, {
    kind: "provider-operation",
    operationId,
    operationKind: row.operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
    ...(row.castResult === undefined ? {} : { castResult: row.castResult }),
    ...(row.isFallible === true && row.isAsync !== true ? { fallible: true } : {}),
  });
  if (row.operationKind === "method" || row.operationKind === "constructor") {
    const member: TargetMember = {
      id: operationId,
      sourceName: identity?.exportName ?? identity?.memberName ?? operationId,
      targetName: targetOperationText,
      kind: row.operationKind === "constructor" ? "constructor" : "method",
      parameters: (row.parameterCarriers ?? []).map((carrier, index) => ({
        name: `arg${index}`,
        type: carrier,
        passingMode: "by-value",
      })),
      returnType: row.resultCarrier,
    };
    walk.lifecycle.host.facts.set(
      expression,
      selectedTargetSignatureFactKey,
      { member, ...(identity === undefined ? {} : { providerDeclaration: identity }) },
      [{ message: `rust provider operation ${operationId}` }],
    );
  }
}

function recordOperatorFacts(
  walk: RustFactWalk,
  expression: Node,
  rustOperator: string,
  resultCarrier: TargetTypeRef,
  carrierKey: string,
): void {
  const operationId = `tsonic.rust.operator.${rustOperator}.${carrierKey}`;
  recordTargetOperation(walk, expression, operationId, "operator", rustOperator);
  setRustOperationFact(walk, expression, {
    kind: "operator-token",
    operationId,
    operator: rustOperator,
    resultCarrier,
  });
}

function recordTargetOperation(
  walk: RustFactWalk,
  expression: Node,
  operationId: string,
  operationKind: "property" | "method" | "indexer" | "operator" | "constructor",
  targetOperation: string,
): void {
  walk.lifecycle.host.facts.set(
    expression,
    targetOperationFactKey,
    { operationId, operationKind, targetOperation },
    [{ message: `rust target operation ${operationId}` }],
  );
}

function setRustOperationFact(walk: RustFactWalk, expression: Node, fact: RustTargetOperationFact): void {
  walk.lifecycle.host.facts.set(expression, rustTargetOperationFactKey, fact, [
    { message: `rust operation ${fact.operationId}` },
  ]);
}

function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(subject, runtimeCarrierFactKey);
  if (existing === undefined) {
    facts.set(subject, runtimeCarrierFactKey, { carrier }, [{ message: "rust carrier" }]);
  }
  return carrier;
}

function appendProviderOperationDiagnostic(
  walk: RustFactWalk,
  identity: ProviderDeclarationIdentity,
  operationKind: string,
): void {
  walk.lifecycle.host.diagnostics.append({
    extensionId: rustTargetSemanticsExtensionId,
    extensionCode: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
    numericCode: 0,
    category: "error",
    message: `No Rust target operation is mapped for provider declaration '${identity.memberId ?? identity.exportId ?? identity.moduleSpecifier}' (${operationKind}).`,
    evidence: [
      { message: `target.capability=rust.provider.${operationKind}` },
      { message: `provider.module=${identity.moduleSpecifier}` },
    ],
  });
}

function collectDescendantsOfKind(walk: RustFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.lifecycle.compiler;
  const results: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.kindName(node) === kindName) {
      results.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return results;
}

// --- JS surface lanes -------------------------------------------------------

interface RustLibMemberIdentity {
  readonly ownerName: string;
  readonly memberName: string;
}

// Identity of a selected lib declaration member: the resolved symbol's
// declaration must live in a non-provider .d.ts file; the owner is the
// enclosing interface declaration. Names are read from the declaration model,
// never from the user expression.
function libMemberIdentityFor(walk: RustFactWalk, reference: Node): RustLibMemberIdentity | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const declaration of checker.getSymbolDeclarations(symbol)) {
    if (declaration === undefined) {
      continue;
    }
    const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
    if (!declarationFile.endsWith(".d.ts") || facts.get(declaration, providerVirtualDeclarationFactKey) !== undefined) {
      continue;
    }
    let owner: Node | undefined = ast.parent(declaration);
    while (owner !== undefined && ast.kindName(owner) !== KindInterfaceDeclaration) {
      owner = ast.parent(owner);
    }
    if (owner === undefined) {
      continue;
    }
    const ownerName = ast.text(ast.name(owner) ?? owner);
    const memberName = checker.getSymbolName(symbol);
    if (ownerName.length > 0 && memberName.length > 0) {
      return { ownerName, memberName };
    }
  }
  return undefined;
}

function applyJsSelection(
  walk: RustFactWalk,
  expression: Node,
  selection: JsOperationSelection,
  sourceFile: SourceFile,
  argumentNodes: readonly (Node | undefined)[],
): TargetTypeRef | undefined {
  let resolvedResultCarrier = selection.resultCarrier;
  if (selection.callbackShape === "reduce") {
    // Resolve the initial value first; its carrier instantiates the
    // accumulator in the callback expectation.
    const initial = argumentNodes[1];
    const accumulator = initial === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initial, sourceFile, selection.parameterCarriers?.[1]);
    const callbackExpectation = selection.parameterCarriers?.[0];
    const arrow = argumentNodes[0];
    if (accumulator === undefined || callbackExpectation?.kind !== "function-pointer" || arrow === undefined) {
      return undefined;
    }
    const instantiated: TargetTypeRef = {
      kind: "function-pointer",
      args: [accumulator, ...callbackExpectation.args.slice(1)],
      result: accumulator,
    };
    if (resolveExpressionCarrier(walk, arrow, sourceFile, instantiated) === undefined) {
      return undefined;
    }
    resolvedResultCarrier = accumulator;
  } else {
    for (const [index, argument] of argumentNodes.entries()) {
      if (argument !== undefined) {
        const expectedArgument = selection.parameterCarriers?.[index];
        const resolved = resolveExpressionCarrier(walk, argument, sourceFile, expectedArgument);
        if (expectedArgument?.kind === "target-named" && resolved !== undefined && JSON.stringify(resolved) !== JSON.stringify(expectedArgument)) {
          // Closed-carrier mismatch: fail closed rather than emit ill-typed Rust.
          return undefined;
        }
      }
    }
    if (selection.callbackShape === "map") {
      const arrow = argumentNodes[0];
      const arrowCarrier = arrow === undefined
        ? undefined
        : walk.lifecycle.host.facts.get(arrow, runtimeCarrierFactKey)?.carrier;
      const bodyResult = arrowCarrier?.kind === "function-pointer" ? arrowCarrier.result : undefined;
      if (bodyResult === undefined || (bodyResult.kind === "opaque" && bodyResult.id === "tsonic.rust.infer")) {
        return undefined;
      }
      resolvedResultCarrier = rustVecTargetType(bodyResult);
    }
  }
  const fact = selection.callbackShape === undefined || resolvedResultCarrier === undefined || selection.fact.kind !== "provider-operation"
    ? selection.fact
    : { ...selection.fact, resultCarrier: resolvedResultCarrier };
  if ((fact.kind === "provider-operation" && fact.target.form === "receiver-method" && fact.target.mutatesReceiver === true) ||
      fact.kind === "runtime-set") {
    // Receiver is the expression's own receiver for member ops.
    const receiver = Node_Expression(expression) !== undefined && walk.lifecycle.compiler.ast.kindName(expression) === KindPropertyAccessExpression
      ? Node_Expression(expression)
      : Node_Expression(Node_Expression(expression) ?? expression) ?? Node_Expression(expression);
    recordBindingWrite(walk, receiver, "referent");
  }
  recordTargetOperation(
    walk,
    expression,
    fact.operationId,
    fact.kind === "provider-operation" ? fact.operationKind : "method",
    fact.operationId,
  );
  setRustOperationFact(walk, expression, fact);
  if (resolvedResultCarrier !== undefined) {
    setCarrierFact(walk, expression, resolvedResultCarrier);
  }
  return resolvedResultCarrier;
}

function selectJsCallForNode(
  walk: RustFactWalk,
  _expression: Node,
  callee: Node,
  _callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): JsOperationSelection | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const identity = libMemberIdentityFor(walk, callee);
  if (identity === undefined) {
    return undefined;
  }
  const receiver = Node_Expression(callee);
  const receiverCarrier = receiver === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  return selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "call",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
  });
}

function selectJsConstructorForNode(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): JsOperationSelection | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const declarations = checker.getSymbolDeclarations(symbol);
  const isLibDeclaration = declarations.some((declaration) =>
    declaration !== undefined &&
    ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts") &&
    facts.get(declaration, providerVirtualDeclarationFactKey) === undefined);
  if (!isLibDeclaration) {
    return undefined;
  }
  const typeArgumentCarriers = ast.typeArguments(expression).map((typeNode) =>
    typeNode === undefined ? undefined : resolveTypeNodeCarrier(walk, typeNode));
  const argumentCarriers = callArguments.map((argument) =>
    argument === undefined ? undefined : resolveExpressionCarrier(walk, argument, sourceFile, undefined));
  return selectJsSurfaceConstructor({
    className: checker.getSymbolName(symbol),
    typeArgumentCarriers,
    argumentCarriers,
  });
}

function resolveArrayLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const elements = ast.elements(expression).filter((element): element is Node => element !== undefined);
  const hasHoles = elements.some((element) => ast.kindName(element) === KindOmittedExpression);
  const presentElements = elements.filter((element) => ast.kindName(element) !== KindOmittedExpression);

  if (expected?.kind === "tuple" && expected.elements.length > 0 && !hasHoles && presentElements.length === expected.elements.length) {
    for (const [index, element] of presentElements.entries()) {
      resolveExpressionCarrier(walk, element, sourceFile, expected.elements[index]);
    }
    setRustOperationFact(walk, expression, {
      kind: "tuple-literal",
      operationId: "tsonic.rust.tuple.literal",
      resultCarrier: expected,
    });
    return setCarrierFact(walk, expression, expected);
  }
  let expectedElement: TargetTypeRef | undefined;
  let lane: "dense" | "sparse" = hasHoles ? "sparse" : "dense";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = expected.typeArguments?.[0];
    lane = "sparse";
  }
  if (expectedElement === undefined) {
    for (const element of presentElements) {
      const carrier = resolveExpressionCarrier(walk, element, sourceFile, undefined);
      if (carrier !== undefined) {
        expectedElement = carrier;
        break;
      }
    }
  }
  if (expectedElement === undefined && presentElements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
    expectedElement = rustSourcePrimitiveTargetType("float64");
  }
  if (expectedElement === undefined) {
    return undefined;
  }
  if (lane === "sparse" && !walk.jsEnabled) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_JS_SURFACE_REQUIRED",
      numericCode: 0,
      category: "error",
      message: "Sparse array literals require the js surface or compat mode for the Rust target.",
      evidence: [{ message: "target.capability=rust.js.sparse-array" }],
    });
    return undefined;
  }
  for (const element of presentElements) {
    resolveExpressionCarrier(walk, element, sourceFile, expectedElement);
  }
  const resultCarrier = lane === "sparse"
    ? rustJsArrayTargetType(expectedElement)
    : rustVecTargetType(expectedElement);
  setRustOperationFact(walk, expression, {
    kind: "array-literal",
    operationId: `tsonic.rust.js.array-literal.${lane}`,
    lane,
    elementCarrier: expectedElement,
    resultCarrier,
    length: elements.length,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function recordForOfFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const iterable = Node_Expression(statement);
  const iterableCarrier = iterable === undefined
    ? undefined
    : resolveExpressionCarrier(walk, iterable, sourceFile, undefined);
  const sliceElement = rustSliceElementCarrier(iterableCarrier);
  const denseElementForOf = iterableCarrier !== undefined && isRustVecCarrier(iterableCarrier)
    ? iterableCarrier.element
    : sliceElement;
  if (iterable !== undefined && denseElementForOf !== undefined && isRustNumericCarrier(denseElementForOf)) {
    const element = denseElementForOf;
    setRustOperationFact(walk, statement, {
      kind: "for-of",
      operationId: "tsonic.rust.js.for-of.dense",
      elementCarrier: element,
      style: "copied",
    });
    const initializer = ForInOrOfStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, element);
      }
    }
  }
  const body = ForInOrOfStatement_Statement(statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

function recordJsAssignmentFacts(
  walk: RustFactWalk,
  assignment: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
): boolean {
  const { ast } = walk.lifecycle.compiler;
  const leftKind = ast.kindName(left);
  if (leftKind === KindPropertyAccessExpression) {
    const identity = libMemberIdentityFor(walk, left);
    const receiver = Node_Expression(left);
    if (identity === undefined || receiver === undefined || !walk.jsEnabled) {
      return false;
    }
    const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    const selection = selectJsSurfaceOperation({
      ownerName: identity.ownerName,
      memberName: identity.memberName,
      operationKind: "property-set",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    });
    if (selection === undefined) {
      return false;
    }
    resolveExpressionCarrier(walk, right, sourceFile, selection.parameterCarriers?.[0]);
    setRustOperationFact(walk, assignment, selection.fact);
    return true;
  }
  if (leftKind === KindElementAccessExpression && walk.jsEnabled) {
    const receiver = Node_Expression(left);
    const receiverCarrier = receiver === undefined
      ? undefined
      : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    if (receiverCarrier === undefined) {
      return false;
    }
    const selection = selectJsSurfaceOperation({
      ownerName: "Array",
      memberName: "index",
      operationKind: "index-set",
      receiverCarrier,
    });
    if (selection === undefined) {
      return false;
    }
    const index = ElementAccessExpression_ArgumentExpression(left);
    if (index !== undefined) {
      resolveExpressionCarrier(walk, index, sourceFile, selection.parameterCarriers?.[0]);
    }
    resolveExpressionCarrier(walk, right, sourceFile, selection.parameterCarriers?.[1]);
    setRustOperationFact(walk, assignment, selection.fact);
    return true;
  }
  return false;
}

function tryRecordOptionUndefinedCheck(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
  negated: boolean,
): TargetTypeRef | undefined {
  const { ast, checker, typeShape } = walk.lifecycle.compiler;
  const isUndefinedLiteral = (node: Node): boolean => {
    if (ast.kindName(node) !== KindIdentifier) {
      return false;
    }
    const type = checker.getTypeAtLocation(node);
    return type !== undefined && typeShape.isVoidLike(type);
  };
  const undefinedSide = isUndefinedLiteral(left) ? left : isUndefinedLiteral(right) ? right : undefined;
  const valueSide = undefinedSide === left ? right : left;
  if (undefinedSide === undefined) {
    return undefined;
  }
  const valueCarrier = resolveExpressionCarrier(walk, valueSide, sourceFile, undefined);
  if (!isRustOptionCarrier(valueCarrier)) {
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "option-check",
    operationId: negated ? "tsonic.rust.js.option.is-some" : "tsonic.rust.js.option.is-none",
    negated,
  });
  recordTargetOperation(walk, expression, "tsonic.rust.js.option-check", "operator", negated ? "is_some" : "is_none");
  return setCarrierFact(walk, expression, boolCarrier);
}

// --- Project-source classes and enums --------------------------------------

function projectDeclarationFor(walk: RustFactWalk, reference: Node): Node | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration === undefined) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return fileName.endsWith(".d.ts") ? undefined : declaration;
}

function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(declaration);
  const shape = kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration"
    ? "struct"
    : kind === "KindEnumDeclaration" || kind === "KindTypeAliasDeclaration" ? "enum" : undefined;
  if (shape === undefined) {
    return undefined;
  }
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  if (typeName.length === 0) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return rustSourceTypeCarrier(fileName, typeName, shape);
}

function sourceTypeCarrierForReference(walk: RustFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const nameNode = TypeReferenceNode_TypeName(typeNode) ?? ast.name(typeNode) ?? typeNode;
  const declaration = projectDeclarationFor(walk, nameNode);
  return declaration === undefined ? undefined : sourceTypeCarrierForDeclaration(walk, declaration);
}

function methodMutatesSelf(walk: RustFactWalk, method: Node): boolean {
  const { ast } = walk.lifecycle.compiler;
  let mutates = false;
  const visit = (node: Node): void => {
    if (mutates) {
      return;
    }
    if (ast.kindName(node) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(node);
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (operatorKind.endsWith("EqualsToken") && operatorKind !== KindEqualsEqualsEqualsTokenName && operatorKind !== KindExclamationEqualsEqualsTokenName) {
        const left = BinaryExpression_Left(node);
        if (left !== undefined && ast.kindName(left) === KindPropertyAccessExpression) {
          const receiver = Node_Expression(left);
          const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
          if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
            mutates = true;
            return;
          }
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(method);
  return mutates;
}

const KindEqualsEqualsEqualsTokenName = "KindEqualsEqualsEqualsToken";
const KindExclamationEqualsEqualsTokenName = "KindExclamationEqualsEqualsToken";

function recordClassFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, classCarrier);
  registerSourceTypeDeclaration(walk, classCarrier, declaration);
  const previousThis = walk.currentThisCarrier;
  walk.currentThisCarrier = classCarrier;
  for (const member of ast.members(declaration)) {
    if (member === undefined) {
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertyDeclaration") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration") {
      for (const parameter of ast.parameters(member)) {
        if (parameter === undefined) {
          continue;
        }
        const parameterCarrier = resolveTypeNodeCarrier(walk, Node_Type(parameter));
        if (parameterCarrier !== undefined) {
          setCarrierFact(walk, parameter, parameterCarrier);
        }
      }
      const returnCarrier = memberKind === "KindMethodDeclaration"
        ? resolveTypeNodeCarrier(walk, Node_Type(member))
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindMethodDeclaration" ? member : undefined;
      const body = ast.body(member);
      if (body !== undefined) {
        for (const statement of ast.statements(body)) {
          if (statement !== undefined) {
            recordStatementFacts(walk, statement, sourceFile, returnCarrier);
          }
        }
      }
      walk.currentMethodDeclaration = previousMethod;
    }
  }
  walk.currentThisCarrier = previousThis;
}

function registerSourceTypeDeclaration(walk: RustFactWalk, carrier: TargetTypeRef, declaration: Node): void {
  const value = rustSourceTypeCarrierValueLocal(carrier);
  if (value !== undefined) {
    walk.sourceTypeDeclarations.set(`${value.fileName}::${value.typeName}`, declaration);
  }
}

function recordInterfaceFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.lifecycle.compiler;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  registerSourceTypeDeclaration(walk, carrier, declaration);
  for (const member of ast.members(declaration)) {
    if (member === undefined || ast.kindName(member) !== "KindPropertySignature") {
      continue;
    }
    const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
    if (fieldCarrier !== undefined) {
      setCarrierFact(walk, member, fieldCarrier);
    }
  }
}

function resolveRecordLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const value = expected === undefined ? undefined : rustSourceTypeCarrierValueLocal(expected);
  if (value === undefined || value.shape !== "struct" || expected === undefined) {
    return undefined;
  }
  const fieldNames: string[] = [];
  for (const property of ast.properties(expression)) {
    if (property === undefined || ast.kindName(property) !== "KindPropertyAssignment") {
      return undefined;
    }
    const nameNode = ast.name(property);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldName.length === 0) {
      return undefined;
    }
    // Expected field carrier from the declared shape member (contextual
    // binding against the finalized declaration model).
    const shapeDeclaration = walk.sourceTypeDeclarations.get(`${value.fileName}::${value.typeName}`);
    const memberDeclaration = shapeDeclaration === undefined
      ? undefined
      : ast.members(shapeDeclaration).find((member) =>
          member !== undefined && ast.text(ast.name(member) ?? member) === fieldName);
    const expectedField = memberDeclaration === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(memberDeclaration, runtimeCarrierFactKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(memberDeclaration));
    const initializer = Node_Initializer(property);
    if (initializer !== undefined) {
      resolveExpressionCarrier(walk, initializer, sourceFile, expectedField);
    }
    fieldNames.push(fieldName);
  }
  setRustOperationFact(walk, expression, {
    kind: "record-literal",
    operationId: "tsonic.rust.record.literal",
    resultCarrier: expected,
    fieldNames,
  });
  return setCarrierFact(walk, expression, expected);
}

function rustSourceTypeCarrierValueLocal(carrier: TargetTypeRef): { readonly fileName: string; readonly typeName: string; readonly shape: string } | undefined {
  if (carrier.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "source-type") {
    return undefined;
  }
  return carrier.value as { readonly fileName: string; readonly typeName: string; readonly shape: string };
}

function rustVariantName(literal: string): string | undefined {
  const cleaned = literal.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/gu, (_, ch: string) => ch.toUpperCase());
  if (cleaned.length === 0 || /^[0-9]/u.test(cleaned)) {
    return undefined;
  }
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function registerUnionAlias(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.lifecycle.compiler;
  const aliasType = Node_Type(declaration);
  if (aliasType === undefined || ast.kindName(aliasType) !== "KindUnionType") {
    return;
  }
  const memberNodes = ast.children(aliasType)
    .filter((child): child is Node => child !== undefined)
    .flatMap((child) => ast.kindName(child) === "KindSyntaxList"
      ? ast.children(child).filter((entry): entry is Node => entry !== undefined)
      : [child])
    .filter((child) => !ast.kindName(child).endsWith("Token"));
  const variants: { name: string; literal: string }[] = [];
  for (const member of memberNodes) {
    if (ast.kindName(member) !== "KindLiteralType") {
      return;
    }
    const literalNode = ast.children(member)[0];
    if (literalNode === undefined || ast.kindName(literalNode) !== KindStringLiteral) {
      return;
    }
    const literal = ast.text(literalNode);
    const name = rustVariantName(literal);
    if (name === undefined || variants.some((existing) => existing.name === name)) {
      return;
    }
    variants.push({ name, literal });
  }
  if (variants.length === 0) {
    return;
  }
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  registerSourceTypeDeclaration(walk, carrier, declaration);
  const value = rustSourceTypeCarrierValueLocal(carrier);
  if (value !== undefined) {
    walk.unionAliasVariants.set(`${value.fileName}::${value.typeName}`, variants);
  }
  walk.lifecycle.host.facts.set(declaration, rustUnionVariantsFactKey, { variants }, [
    { message: "rust union variants" },
  ]);
}

function recordEnumFacts(walk: RustFactWalk, declaration: Node, _sourceFile: SourceFile): void {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier !== undefined) {
    setCarrierFact(walk, declaration, carrier);
  }
}

function trySourceMemberAccess(
  walk: RustFactWalk,
  expression: Node,
  receiver: Node | undefined,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const memberDeclaration = projectDeclarationFor(walk, expression);
  if (memberDeclaration === undefined) {
    return undefined;
  }
  const memberKind = ast.kindName(memberDeclaration);
  if (memberKind === "KindPropertyDeclaration" || memberKind === "KindPropertySignature") {
    if (memberKind === "KindPropertySignature") {
      const owner = ast.parent(memberDeclaration);
      if (owner === undefined || ast.kindName(owner) !== KindInterfaceDeclaration) {
        return undefined;
      }
    }
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    const fieldCarrier = walk.lifecycle.host.facts.get(memberDeclaration, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(memberDeclaration));
    const nameNode = ast.name(memberDeclaration);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldCarrier === undefined || fieldName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.rust.source.field:${fieldName}`;
    recordTargetOperation(walk, expression, operationId, "property", fieldName);
    setRustOperationFact(walk, expression, {
      kind: "source-field",
      operationId,
      name: fieldName,
      resultCarrier: fieldCarrier,
    });
    return setCarrierFact(walk, expression, fieldCarrier);
  }
  if (memberKind === "KindEnumMember") {
    const enumDeclaration = ast.parent(memberDeclaration);
    const enumCarrier = enumDeclaration === undefined
      ? undefined
      : sourceTypeCarrierForDeclaration(walk, enumDeclaration);
    const nameNode = ast.name(memberDeclaration);
    const memberName = nameNode === undefined ? "" : ast.text(nameNode);
    if (enumCarrier === undefined || memberName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.rust.source.enum-member:${memberName}`;
    recordTargetOperation(walk, expression, operationId, "property", memberName);
    setRustOperationFact(walk, expression, {
      kind: "source-enum-member",
      operationId,
      name: memberName,
      resultCarrier: enumCarrier,
    });
    return setCarrierFact(walk, expression, enumCarrier);
  }
  return undefined;
}

function trySourceCallLike(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (expressionKind === KindNewExpression) {
    const classDeclaration = projectDeclarationFor(walk, callee);
    if (classDeclaration === undefined || ast.kindName(classDeclaration) !== "KindClassDeclaration") {
      return undefined;
    }
    const classCarrier = sourceTypeCarrierForDeclaration(walk, classDeclaration);
    if (classCarrier === undefined) {
      return undefined;
    }
    const constructorMember = ast.members(classDeclaration).find((member) =>
      member !== undefined && ast.kindName(member) === "KindConstructor");
    const parameters = constructorMember === undefined ? [] : ast.parameters(constructorMember);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      const parameter = parameters[index];
      const expected = parameter === undefined
        ? undefined
        : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(parameter));
      resolveExpressionCarrier(walk, argument, sourceFile, expected);
    }
    const operationId = "tsonic.rust.source.constructor";
    recordTargetOperation(walk, expression, operationId, "constructor", "new");
    setRustOperationFact(walk, expression, {
      kind: "source-constructor",
      operationId,
      resultCarrier: classCarrier,
    });
    return setCarrierFact(walk, expression, classCarrier);
  }
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const methodDeclaration = projectDeclarationFor(walk, callee);
  if (methodDeclaration === undefined || ast.kindName(methodDeclaration) !== "KindMethodDeclaration") {
    return undefined;
  }
  const isStaticMethod = ast.hasModifierKind(methodDeclaration, "static");
  const receiver = Node_Expression(callee);
  if (receiver !== undefined && !isStaticMethod) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  const parameters = ast.parameters(methodDeclaration);
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      continue;
    }
    const parameter = parameters[index];
    const expected = parameter === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(parameter));
    resolveExpressionCarrier(walk, argument, sourceFile, expected);
  }
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(methodDeclaration)) ?? rustUnitTargetType();
  const nameNode = ast.name(methodDeclaration);
  const methodName = nameNode === undefined ? "" : ast.text(nameNode);
  if (methodName.length === 0) {
    return undefined;
  }
  if (isStaticMethod) {
    const classDeclaration = ast.parent(methodDeclaration);
    const typeCarrier = classDeclaration === undefined
      ? undefined
      : sourceTypeCarrierForDeclaration(walk, classDeclaration);
    if (typeCarrier === undefined) {
      return undefined;
    }
    const operationId = `tsonic.rust.source.static-method:${methodName}`;
    recordTargetOperation(walk, expression, operationId, "method", methodName);
    setRustOperationFact(walk, expression, {
      kind: "source-static-method",
      operationId,
      name: methodName,
      typeCarrier,
      resultCarrier: returnCarrier,
      ...(walk.lifecycle.host.facts.get(methodDeclaration, rustFallibleFactKey) !== undefined ? { fallible: true } : {}),
    });
    return setCarrierFact(walk, expression, returnCarrier);
  }
  const mutatesSelf = methodMutatesSelf(walk, methodDeclaration);
  if (mutatesSelf) {
    recordBindingWrite(walk, receiver, "referent");
  }
  const operationId = `tsonic.rust.source.method:${methodName}`;
  recordTargetOperation(walk, expression, operationId, "method", methodName);
  setRustOperationFact(walk, expression, {
    kind: "source-method",
    operationId,
    name: methodName,
    mutatesSelf,
    resultCarrier: returnCarrier,
    ...(walk.lifecycle.host.facts.get(methodDeclaration, rustFallibleFactKey) !== undefined ? { fallible: true } : {}),
  });
  return setCarrierFact(walk, expression, returnCarrier);
}

// Owned dense arrays never cross function boundaries by value: mutable array
// parameters take the &mut [T] lane (TypeScript array arguments are reference
// -visible), readonly parameters take &[T].
function parameterLaneCarrier(walk: RustFactWalk, carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  void walk;
  if (carrier !== undefined && isRustVecCarrier(carrier)) {
    return rustSliceMutRefTargetType(carrier.element);
  }
  return carrier;
}

// Formal source-use rule: a write records a mutation fact on the resolved
// declaration of the written binding (or a mut-ref self mode on the enclosing
// method for `this` field writes). Backend mutability reads facts only.
function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  if (target === undefined) {
    return;
  }
  const { ast, checker } = walk.lifecycle.compiler;
  const kind = ast.kindName(target);
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
      if (walk.currentMethodDeclaration !== undefined) {
        walk.lifecycle.host.facts.set(walk.currentMethodDeclaration, rustSelfModeFactKey, { mode: "mut-ref" }, [
          { message: "rust self write" },
        ]);
      }
      return;
    }
    recordBindingWrite(walk, receiver, "referent");
    return;
  }
  if (kind === KindCallExpression) {
    const fact = walk.lifecycle.host.facts.get(target, rustTargetOperationFactKey);
    if (fact !== undefined && fact.kind === "flow-marker") {
      recordBindingWrite(walk, ast.arguments(target)[0], "referent");
    }
    return;
  }
  if (kind !== KindIdentifier) {
    return;
  }
  const symbol = checker.getResolvedSymbolOrNil(target) ?? checker.getSymbolAtLocation(target);
  if (symbol === undefined) {
    return;
  }
  const declaration = checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration !== undefined) {
    const key = writeKind === "binding" ? rustMutatedBindingFactKey : rustMutatedReferentFactKey;
    walk.lifecycle.host.facts.set(declaration, key, { mutated: true }, [
      { message: `rust ${writeKind} write` },
    ]);
  }
}

// --- Source-core flow markers ----------------------------------------------

interface FlowMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

// The generic source-semantics extension records flowStateFactKey on marker
// calls (borrow/borrowMut/move) and argumentPassingFactKey on out/ref/inref
// calls. The Rust target lowers flow markers by erasure (the consuming
// position's finalized argument mode owns the passing shape) and rejects the
// by-ref passing markers, which have no Rust lane.
function tryFlowMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): FlowMarkerResolution | undefined {
  const facts = walk.lifecycle.host.facts;
  const passing = facts.get(expression, argumentPassingFactKey);
  if (passing !== undefined && passing.mode.startsWith("byref")) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_SOURCE_MARKER_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: `Source passing marker mode '${passing.mode}' has no Rust target lane; use borrow/borrowMut/move markers with finalized argument modes.`,
      evidence: [{ message: "target.capability=rust.source.passing-marker" }],
    });
    return { carrier: undefined };
  }
  const flow = facts.get(expression, flowStateFactKey);
  if (flow === undefined) {
    return undefined;
  }
  const [argument] = callArguments;
  const argumentCarrier = argument === undefined
    ? undefined
    : resolveExpressionCarrier(walk, argument, sourceFile, expected);
  if (flow.state !== "moved" && flow.state !== "borrowed-shared" && flow.state !== "borrowed-mut") {
    return { carrier: undefined };
  }
  setRustOperationFact(walk, expression, {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${flow.state}`,
    state: flow.state,
  });
  if (argumentCarrier !== undefined) {
    setCarrierFact(walk, expression, argumentCarrier);
  }
  return { carrier: argumentCarrier };
}

function rowArgumentMode(row: RustProviderOperationRow, index: number): "value" | "ref" | "mut-ref" {
  const target = row.target;
  if (target.form === "call" || target.form === "free-call" || target.form === "receiver-method") {
    return target.argModes?.[index] ?? "value";
  }
  return "value";
}

function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
): void {
  const flow = walk.lifecycle.host.facts.get(argument, flowStateFactKey) ??
    walk.lifecycle.host.facts.get(argument, flowStateFactKey);
  const rustFact = walk.lifecycle.host.facts.get(argument, rustTargetOperationFactKey);
  const markerState = rustFact !== undefined && rustFact.kind === "flow-marker" ? rustFact.state : flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref") ||
    (markerState === "borrowed-mut" && mode === "mut-ref");
  if (!compatible) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_FLOW_MARKER_MISMATCH",
      numericCode: 0,
      category: "error",
      message: `Flow marker state '${markerState}' does not match the finalized argument mode '${mode}' for this position.`,
      evidence: [{ message: "target.capability=rust.source.flow-marker" }],
    });
  }
}

// --- Error model -------------------------------------------------------------

// Fallibility: a declaration lowers to TsonicResult when it throws or calls a
// fallible operation outside a try boundary. Computed to a fixpoint over all
// project declarations before the main fact walk.
function recordFallibilityFacts(walk: RustFactWalk): void {
  const { ast, checker } = walk.lifecycle.compiler;
  const declarations: Node[] = [];
  for (const sourceFile of walk.lifecycle.compiler.getSourceFiles()) {
    if (sourceFile === undefined || ast.getFileName(sourceFile).endsWith(".d.ts")) {
      continue;
    }
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        declarations.push(statement);
      } else if (kind === "KindClassDeclaration") {
        for (const member of ast.members(statement)) {
          if (member !== undefined && (ast.kindName(member) === "KindMethodDeclaration" || ast.kindName(member) === "KindConstructor")) {
            declarations.push(member);
          }
        }
      }
    }
  }
  const fallible = new Set<Node>();
  const declarationFallible = (declaration: Node): boolean => fallible.has(declaration);

  const bodyIsFallible = (declaration: Node): boolean => {
    const body = ast.body(declaration);
    if (body === undefined) {
      return false;
    }
    let found = false;
    const visit = (node: Node, insideTry: boolean): void => {
      if (found) {
        return;
      }
      const kind = ast.kindName(node);
      if (kind === "KindThrowStatement" && !insideTry) {
        found = true;
        return;
      }
      if (kind === "KindArrowFunction") {
        // Closures are fallibility boundaries: errors cannot propagate out.
        return;
      }
      if (kind === "KindTryStatement") {
        const tryBlock = TryStatement_TryBlock(node);
        const catchBlock = CatchClause_Block(TryStatement_CatchClause(node));
        if (tryBlock !== undefined) {
          visit(tryBlock, true);
        }
        if (catchBlock !== undefined) {
          visit(catchBlock, insideTry);
        }
        return;
      }
      if (kind === KindCallExpression && !insideTry) {
        const callee = Node_Expression(node);
        // Provider fallible rows.
        const identity = callee === undefined ? undefined : providerDeclarationIdentityFor(walk, callee);
        if (identity !== undefined) {
          const row = matchProviderRow(walk.providerRows, identity, "method");
          if (row?.isFallible === true) {
            found = true;
            return;
          }
        } else if (callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression && walk.jsEnabled) {
          const libIdentity = libMemberIdentityFor(walk, callee);
          if (libIdentity !== undefined && jsOperationMayBeFallible(libIdentity.ownerName, libIdentity.memberName)) {
            found = true;
            return;
          }
          // Fall through to source-owned resolution for non-fallible members.
          const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
          const aliased = symbol === undefined ? undefined : safeAliasedSymbol(checker, symbol);
          const target = symbol === undefined
            ? undefined
            : (aliased === undefined ? undefined : checker.getSymbolValueDeclaration(aliased)) ??
              checker.getSymbolValueDeclaration(symbol) ??
              checker.getSymbolDeclarations(symbol)[0];
          if (target !== undefined && declarationFallible(target)) {
            found = true;
            return;
          }
        } else if (callee !== undefined) {
          const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
          const aliased = symbol === undefined ? undefined : safeAliasedSymbol(checker, symbol);
          const target = symbol === undefined
            ? undefined
            : (aliased === undefined ? undefined : checker.getSymbolValueDeclaration(aliased)) ??
              checker.getSymbolValueDeclaration(symbol) ??
              (aliased === undefined ? undefined : checker.getPrimarySymbolDeclaration(aliased)) ??
              checker.getPrimarySymbolDeclaration(symbol) ??
              checker.getSymbolDeclarations(symbol)[0];
          if (target !== undefined && declarationFallible(target)) {
            found = true;
            return;
          }
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child, insideTry);
        }
      });
    };
    visit(body, false);
    return found;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!fallible.has(declaration) && bodyIsFallible(declaration)) {
        fallible.add(declaration);
        changed = true;
      }
    }
  }
  for (const declaration of fallible) {
    walk.lifecycle.host.facts.set(declaration, rustFallibleFactKey, { fallible: true }, [
      { message: "rust fallible declaration" },
    ]);
  }
}

// `throw new Error(message)` records a throw fact; anything else stays an
// unsupported statement for the backend.
function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const { ast, checker } = walk.lifecycle.compiler;
  const expression = Node_Expression(statement);
  if (expression === undefined || ast.kindName(expression) !== KindNewExpression) {
    return;
  }
  const callee = Node_Expression(expression);
  const symbol = callee === undefined
    ? undefined
    : checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined || checker.getSymbolName(symbol) !== "Error") {
    return;
  }
  const isLibError = checker.getSymbolDeclarations(symbol).some((declaration) =>
    declaration !== undefined && ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts"));
  if (!isLibError) {
    return;
  }
  const [message] = ast.arguments(expression);
  if (message !== undefined) {
    resolveExpressionCarrier(walk, message, sourceFile, rustStringTargetType());
  }
  setRustOperationFact(walk, statement, {
    kind: "throw-op",
    operationId: "tsonic.rust.error.throw",
  });
}

// Arrow-function arguments lower to Rust closures when the expectation is a
// finalized function-pointer carrier. Expression bodies only.
function resolveArrowFunctionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (expected?.kind !== "function-pointer") {
    return undefined;
  }
  const parameters = ast.parameters(expression);
  if (parameters.length !== expected.args.length) {
    return undefined;
  }
  const byRefCopyParams: boolean[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter === undefined) {
      return undefined;
    }
    const argCarrier = expected.args[index];
    if (argCarrier === undefined || (argCarrier.kind === "opaque" && argCarrier.id === "tsonic.rust.infer")) {
      return undefined;
    }
    setCarrierFact(walk, parameter, argCarrier);
    // Slice-based dense helpers hand elements by reference: primitive
    // elements bind with |&x| copy patterns; accumulators pass by value.
    byRefCopyParams.push(index === parameters.length - 1 && argCarrier.kind === "source-primitive");
  }
  const body = ast.body(expression);
  if (body === undefined || ast.kindName(body) === KindBlock) {
    return undefined;
  }
  const resultExpectation = expected.result.kind === "opaque" && expected.result.id === "tsonic.rust.infer"
    ? undefined
    : expected.result;
  const bodyCarrier = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
  if (bodyCarrier === undefined) {
    return undefined;
  }
  const closureCarrier: TargetTypeRef = {
    kind: "function-pointer",
    args: expected.args,
    result: bodyCarrier,
  };
  setRustOperationFact(walk, expression, {
    kind: "closure",
    operationId: "tsonic.rust.closure",
    byRefCopyParams,
    resultCarrier: closureCarrier,
  });
  return setCarrierFact(walk, expression, closureCarrier);
}
