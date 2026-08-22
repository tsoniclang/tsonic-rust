import {
  CatchClause_Block,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  KindCallExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindIdentifier,
  KindNewExpression,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
  asSourceNode,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustBindingProjectionFactKey,
  rustContextualValueConversionFactKey,
  rustFallibleFactKey,
  rustModuleBindingFactKey,
  rustMutatedBindingFactKey,
  rustObjectLiteralMethodAdapterFactKey,
  rustSelfModeFactKey,
  rustSourceAccessorEffectsFactKey,
  rustSourceCallEffectsFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { finalizeRustPreparedCheckedCall } from "../operations/provider/index.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordSelectedOperationInputs } from "../operations/inputs.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { rustFutureOutputCarrier, rustCallableProtocol } from "../../target-model/types/index.js";
import { rustInheritedProjectConstructor } from "../project-types/type-policy.js";
import { rustOperationAbiAwaitIsFallible, rustTargetOperationIsFallible } from "../facts/target-operation.js";
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";
import { rustSelectedCallKey, rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustValueConversionIsFallible } from "../../target-model/conversions/contracts.js";
import { selectedDeclarationIsProjectSource } from "../expressions/references.js";
import { selectRustResourceManagement } from "./management.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustPreparedDeferredCheckedCall } from "../operations/provider/index.js";
import type { RustTargetOperationFact } from "../facts/keys.js";

interface RustFutureOperationOrigin {
  readonly expression: Node;
  readonly operation: RustTargetOperationFact;
}

function resolveFutureOperationOrigin(
  walk: RustFactWalk,
  node: Node,
  resolving = new Set<Node>(),
): RustFutureOperationOrigin | undefined {
  if (resolving.has(node)) {
    return undefined;
  }
  resolving.add(node);
  try {
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    if ((operation?.kind === "provider-operation" && operation.abi.result.kind === "async") ||
      (operation?.kind === "source-call" && rustFutureOutputCarrier(operation.resultCarrier) !== undefined)) {
      return { expression: node, operation };
    }
    const kind = walk.context.ast.kindName(node);
    if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      const operand = Node_Expression(walk.context.ast, node);
      return operand === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, operand, resolving);
    }
    if (kind === KindVariableDeclaration) {
      if (walk.context.facts.get(node, rustMutatedBindingFactKey) !== undefined) {
        return undefined;
      }
      const initializer = Node_Initializer(walk.context.ast, node);
      return initializer === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, initializer, resolving);
    }
    if (kind === KindIdentifier) {
      const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
      return declaration === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, declaration, resolving);
    }
    return undefined;
  } finally {
    resolving.delete(node);
  }
}

export function recordFallibilityFacts(walk: RustFactWalk, projectSourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.context;
  const declarations: Node[] = [];
  const declarationSet = new Set<Node>();
  const regionsByDeclaration = new Map<Node, Set<Node>>();
  const relatedDeclarations = new Map<Node, Set<Node>>();
  const dependenciesByDeclaration = new Map<Node, Set<Node>>();
  const addDeclaration = (declaration: Node): void => {
    if (!declarationSet.has(declaration)) {
      declarationSet.add(declaration);
      declarations.push(declaration);
    }
  };
  const addRegion = (declaration: Node, region: Node | undefined): void => {
    addDeclaration(declaration);
    if (region === undefined) {
      return;
    }
    const regions = regionsByDeclaration.get(declaration) ?? new Set<Node>();
    regions.add(region);
    regionsByDeclaration.set(declaration, regions);
  };
  const relateDeclarations = (left: Node, right: Node): void => {
    addDeclaration(left);
    addDeclaration(right);
    if (left === right) {
      return;
    }
    const leftRelations = relatedDeclarations.get(left) ?? new Set<Node>();
    const rightRelations = relatedDeclarations.get(right) ?? new Set<Node>();
    leftRelations.add(right);
    rightRelations.add(left);
    relatedDeclarations.set(left, leftRelations);
    relatedDeclarations.set(right, rightRelations);
  };
  const addDeclarationDependency = (declaration: Node, dependency: Node): void => {
    addDeclaration(declaration);
    addDeclaration(dependency);
    const dependencies = dependenciesByDeclaration.get(declaration) ?? new Set<Node>();
    dependencies.add(dependency);
    dependenciesByDeclaration.set(declaration, dependencies);
  };
  const registerCallableDeclaration = (declaration: Node): void => {
    addRegion(declaration, ast.body(declaration));
    const implementation = walk.context.source.navigation.callableImplementation(declaration);
    if (implementation.kind !== "resolved") {
      return;
    }
    const implementationDeclaration = implementation.implementation.declaration;
    addRegion(implementationDeclaration, ast.body(implementationDeclaration));
    relateDeclarations(declaration, implementationDeclaration);
  };
  const callableMemberKind = (node: Node): boolean => {
    const kind = ast.kindName(node);
    return kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
      kind === "KindGetAccessor" || kind === "KindSetAccessor";
  };
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        registerCallableDeclaration(statement);
      } else if (kind === KindVariableStatement) {
        const declarations = VariableDeclarationList_Declarations(
          ast,
          VariableStatement_DeclarationList(ast, statement),
        );
        if (declarations === undefined || !isDenseDataArray(declarations)) {
          return;
        }
        for (const declaration of declarations) {
          const binding = declaration === undefined
            ? undefined
            : walk.context.facts.get(declaration, rustModuleBindingFactKey) ??
              walk.context.facts.resolve(declaration, rustModuleBindingFactKey);
          if (binding?.storage === "native-callable") {
            addRegion(
              binding.callableDeclaration,
              ast.body(binding.callableDeclaration),
            );
          }
        }
      } else if (kind === "KindClassDeclaration") {
        const members = requireDenseSourceNodes(walk, ast.members(statement), "Class declaration contains an undefined or non-data member slot.");
        if (members === undefined) {
          return;
        }
        const constructors = members.filter((member) =>
          ast.kindName(member) === "KindConstructor");
        const constructorImplementation = constructors.find((member) =>
          ast.body(member) !== undefined);
        const constructorSubject = constructorImplementation ?? statement;
        addDeclaration(constructorSubject);
        for (const constructor of constructors) {
          registerCallableDeclaration(constructor);
          relateDeclarations(constructorSubject, constructor);
        }
        for (const member of members) {
          if (ast.kindName(member) === "KindPropertyDeclaration") {
            if (!ast.hasModifierKind(member, "static")) {
              addRegion(constructorSubject, Node_Initializer(ast, member));
            }
          } else if (callableMemberKind(member)) {
            registerCallableDeclaration(member);
          }
        }
      }
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visitObjectLiteralMethods = (node: Node): void => {
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(node, rustTargetOperationFactKey);
      if (operation?.kind === "record-literal") {
        for (const contribution of operation.contributions) {
          if (contribution.kind !== "method") {
            continue;
          }
          addRegion(contribution.expression, ast.body(contribution.expression));
          for (const declaration of contribution.contractDeclarations) {
            addDeclarationDependency(declaration, contribution.expression);
          }
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visitObjectLiteralMethods(child);
        }
      });
    };
    visitObjectLiteralMethods(sourceFile);
  }
  for (const definition of walk.context.projectTypes.definitions) {
    const members = requireDenseSourceNodes(
      walk,
      ast.members(definition.declaration),
      "Project type declaration contains an undefined or non-data member slot.",
    );
    if (members === undefined) {
      return;
    }
    for (const member of members) {
      if (!callableMemberKind(member) || ast.hasModifierKind(member, "static")) {
        continue;
      }
      registerCallableDeclaration(member);
      for (const concrete of walk.context.projectTypes.concreteClassesFor(definition)) {
        const implementation = walk.context.projectTypes.memberImplementation(concrete, member);
        if (implementation.kind !== "resolved") {
          continue;
        }
        const implementationDeclaration = implementation.implementation.declaration;
        addRegion(implementationDeclaration, ast.body(implementationDeclaration));
        relateDeclarations(member, implementationDeclaration);
      }
    }
    if (definition.kind === "class") {
      for (const signature of walk.context.projectTypes.constructorsForDefinition(definition)) {
        const inherited = rustInheritedProjectConstructor(
          walk.context.projectTypes,
          definition,
          signature,
        );
        if (inherited !== undefined) {
          addDeclarationDependency(
            definition.declaration,
            inherited.constructor.declaration ?? inherited.base.declaration,
          );
        }
      }
    }
  }
  const fallible = new Set<Node>();
  for (const usage of walk.context.projectMethodProperties.usages) {
    if (usage.writable) {
      fallible.add(usage.declaration);
    }
  }
  for (const expression of walk.objectLiteralMethodExpressions) {
    const adapters = walk.context.facts.get(expression, rustObjectLiteralMethodAdapterFactKey) ??
      walk.context.facts.resolve(expression, rustObjectLiteralMethodAdapterFactKey);
    for (const dispatch of adapters?.dispatches ?? []) {
      if (dispatch.adapterFallible) {
        fallible.add(dispatch.contractMethod);
      }
    }
  }
  for (const expression of walk.objectLiteralMethodSpreadExpressions) {
    const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(expression, rustTargetOperationFactKey);
    if (operation?.kind !== "record-literal") {
      continue;
    }
    for (const contribution of operation.contributions) {
      if (contribution.kind !== "spread") {
        continue;
      }
      for (const method of contribution.methods) {
        fallible.add(method.contractDeclaration);
      }
    }
  }
  const selectedProjectDeclaration = (node: Node): Node | undefined => {
    const selected = walk.context.facts.get(node, rustSelectedCallKey) ??
      walk.context.facts.resolve(node, rustSelectedCallKey);
    const declaration = asSourceNode(
      selected?.sourceDeclaration,
      walk.context.ast,
    );
    return declaration !== undefined && selectedDeclarationIsProjectSource(walk, declaration)
      ? declaration
      : undefined;
  };
  const operationIsFallible = (node: Node): boolean => {
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    const bindingProjection = walk.context.facts.get(node, rustBindingProjectionFactKey) ??
      walk.context.facts.resolve(node, rustBindingProjectionFactKey);
    const contextualConversion = walk.context.facts.get(
      node,
      rustContextualValueConversionFactKey,
    ) ?? walk.context.facts.resolve(node, rustContextualValueConversionFactKey);
    const projection = bindingProjection?.projection;
    const bindingProjectionIsFallible = bindingProjection === undefined
      ? false
      : projection?.kind === "object-field"
      ? projection.accessor !== undefined ||
        projection.storage === "object-handle" &&
          walk.context.structuralShapes.field(
            bindingProjection.sourceCarrier,
            projection.storageIndex,
          )?.storage === "property"
      : projection?.kind === "object-rest" &&
        projection.fields.some((field) => field.accessor !== undefined ||
          projection.storage === "object-handle" &&
            walk.context.structuralShapes.field(
              bindingProjection.sourceCarrier,
              field.sourceStorageIndex,
            )?.storage === "property");
    return rustTargetOperationIsFallible(
      operation,
      walk.context.structuralShapes,
      walk.context.projectFieldDispatch,
    ) ||
      bindingProjectionIsFallible ||
      rustValueConversionIsFallible(contextualConversion?.conversion);
  };
  const selectedAccessorDeclarations = (node: Node): readonly Node[] => {
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    if (operation?.kind !== "source-accessor") {
      return [];
    }
    const selected = walk.context.facts.get(node, rustSelectedOperationKey) ??
      walk.context.facts.resolve(node, rustSelectedOperationKey);
    return [
      asSourceNode(
        selected?.provenance?.sourceSelectedReadDeclaration,
        walk.context.ast,
      ),
      asSourceNode(
        selected?.provenance?.sourceSelectedWriteDeclaration,
        walk.context.ast,
      ),
    ].filter((declaration): declaration is Node => declaration !== undefined);
  };

  const callbackExpression = (
    pending: { readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): Node | undefined => pending.request.source.sourceArguments[
    pending.prepared.callback.sourceArgumentIndex
  ]?.expression;
  const callbackValueExpression = (expression: Node | undefined): Node | undefined => {
    let current = expression;
    while (current !== undefined && ast.kindName(current) === KindParenthesizedExpression) {
      current = Node_Expression(ast, current);
    }
    return current;
  };
  interface CallbackValueAnalysis {
    readonly fallible: boolean;
    readonly subjects: readonly Node[];
  }
  const callbackExpressionIsFallible = (
    pending: { readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): boolean => callbackValueAnalysis(callbackExpression(pending), new Set())?.fallible === true;
  const callbackValueAnalysis = (
    expression: Node | undefined,
    resolving: Set<Node>,
  ): CallbackValueAnalysis | undefined => {
    const value = callbackValueExpression(expression);
    if (value === undefined || resolving.has(value)) {
      return undefined;
    }
    resolving.add(value);
    try {
      const body = ast.body(value);
      if (body !== undefined) {
        return {
          fallible: expressionRegionIsFallible(body),
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (fallible.has(declaration)) {
        return { fallible: true, subjects: [value, declaration] };
      }
      const declarationBody = ast.body(declaration);
      if (declarationBody !== undefined) {
        return {
          fallible: expressionRegionIsFallible(declarationBody),
          subjects: [value, declaration],
        };
      }
      const initialized = callbackValueAnalysis(Node_Initializer(ast, declaration), resolving);
      return initialized === undefined
        ? undefined
        : {
            fallible: initialized.fallible,
            subjects: [value, declaration, ...initialized.subjects],
          };
    } finally {
      resolving.delete(value);
    }
  };
  const preparedCallbackOperationIsFallible = (node: Node): boolean => {
    const pending = walk.preparedCallbackCalls.get(node);
    return pending !== undefined && (
      pending.prepared.template.isFallible || callbackExpressionIsFallible(pending)
    );
  };
  function expressionRegionIsFallible(root: Node): boolean {
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
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
        // Closures are fallibility boundaries: errors cannot propagate out.
        return;
      }
      if (kind === "KindRegularExpressionLiteral" && !insideTry) {
        // Constant RegExp construction is fallible at runtime.
        found = true;
        return;
      }
      if (kind === KindVariableDeclaration &&
        (ast.variableDeclarationKind(node) === "using" ||
          ast.variableDeclarationKind(node) === "await using")) {
        const selected = selectRustResourceManagement(
          node,
          rustOperationContext(walk, node),
          walk.operationOptions,
          (declaration) => {
            const selfMode = walk.context.facts.get(declaration, rustSelfModeFactKey);
            if (selfMode === undefined) {
              return undefined;
            }
            return {
              selfMode,
              async: walk.context.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined,
              fallible: fallible.has(declaration),
            };
          },
        );
        if (!insideTry && selected.kind === "selected" && selected.fact.disposal.fallible) {
          found = true;
          return;
        }
      }
      if (kind === "KindTryStatement") {
        const tryBlock = TryStatement_TryBlock(walk.context.ast, node);
        const catchBlock = CatchClause_Block(walk.context.ast, TryStatement_CatchClause(walk.context.ast, node));
        const finallyBlock = TryStatement_FinallyBlock(walk.context.ast, node);
        if (tryBlock !== undefined) {
          visit(tryBlock, catchBlock === undefined ? insideTry : true);
        }
        if (catchBlock !== undefined) {
          visit(catchBlock, insideTry);
        }
        if (finallyBlock !== undefined) {
          visit(finallyBlock, insideTry);
        }
        return;
      }
      if (!insideTry && (operationIsFallible(node) || preparedCallbackOperationIsFallible(node))) {
        found = true;
        return;
      }
      if (!insideTry && selectedAccessorDeclarations(node).some((declaration) =>
        fallible.has(declaration))) {
        found = true;
        return;
      }
      if (!insideTry && kind === "KindAwaitExpression") {
        const operand = Node_Expression(walk.context.ast, node);
        const origin = operand === undefined ? undefined : resolveFutureOperationOrigin(walk, operand);
        const operandFact = origin?.operation;
        const selectedDeclaration = origin === undefined
          ? undefined
          : selectedProjectDeclaration(origin.expression);
        const selectedAsync = selectedDeclaration !== undefined &&
          walk.context.facts.get(selectedDeclaration, rustAsyncFunctionFactKey) !== undefined;
        if ((operandFact?.kind === "provider-operation" && rustOperationAbiAwaitIsFallible(operandFact.abi)) ||
          (operandFact?.kind === "source-call" && selectedDeclaration !== undefined &&
            selectedAsync && fallible.has(selectedDeclaration))) {
          found = true;
          return;
        }
      }
      if (!insideTry && (kind === KindCallExpression || kind === KindNewExpression)) {
        const target = selectedProjectDeclaration(node);
        if (target !== undefined && fallible.has(target) &&
          walk.context.facts.get(target, rustAsyncFunctionFactKey) === undefined) {
          found = true;
          return;
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child, insideTry);
        }
      });
    };
    visit(root, false);
    return found;
  }
  const declarationIsFallible = (declaration: Node): boolean =>
    [...(regionsByDeclaration.get(declaration) ?? [])].some(expressionRegionIsFallible) ||
    [...(dependenciesByDeclaration.get(declaration) ?? [])].some((dependency) =>
      fallible.has(dependency));

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!fallible.has(declaration) && declarationIsFallible(declaration)) {
        fallible.add(declaration);
        changed = true;
      }
    }
    for (const [declaration, related] of relatedDeclarations) {
      if (!fallible.has(declaration) && [...related].some((candidate) => fallible.has(candidate))) {
        fallible.add(declaration);
        changed = true;
      }
    }
  }
  const ownedCallbackClosures = new Set<Node>();
  for (const [call, pending] of walk.preparedCallbackCalls) {
    const callbackArgument = callbackValueExpression(callbackExpression(pending));
    const callbackAnalysis = callbackValueAnalysis(callbackArgument, new Set());
    if (callbackAnalysis === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_CALLBACK_VALUE_NOT_PROVEN",
        "The selected provider callback argument does not resolve to one exact project-source callable implementation.",
        callbackArgument ?? call,
        ["target.capability=rust.callback.exact-source"],
      );
      continue;
    }
    for (const subject of callbackAnalysis.subjects) {
      ownedCallbackClosures.add(subject);
    }
    const sourceFile = ast.getSourceFile(call);
    if (sourceFile === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_CALLBACK_SOURCE_FILE_MISSING",
        "Prepared callback operation has no owning checked source file.",
        call,
        ["target.capability=rust.callback.exact-source"],
      );
      continue;
    }
    const callbackFallible = callbackAnalysis.fallible;
    const finalized = finalizeRustPreparedCheckedCall(
      pending.request,
      pending.prepared,
      callbackFallible,
      rustOperationContext(walk, call),
      walk.operationOptions,
    );
    if (finalized.kind === "reject") {
      walk.context.diagnostics.push(rustPolicyTargetDiagnostic(finalized.diagnostic));
      continue;
    }
    const operation = walk.context.facts.get(call, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(call, rustTargetOperationFactKey);
    recordSelectedOperationInputs(walk, call, sourceFile, operation);
    if (callbackFallible) {
      for (const subject of callbackAnalysis.subjects) {
        walk.context.facts.set(subject, rustFallibleFactKey, { fallible: true }, [
          { message: "rust fallible callback ABI" },
        ]);
      }
    }
  }
  for (const declaration of fallible) {
    walk.context.facts.set(declaration, rustFallibleFactKey, { fallible: true }, [
      { message: "rust fallible declaration" },
    ]);
  }
  for (const sourceFile of projectSourceFiles) {
    const runtimeStatements = (ast.statements(sourceFile) as readonly Node[]).filter((statement) => {
      const kind = ast.kindName(statement);
      return kind !== KindFunctionDeclaration &&
        kind !== "KindClassDeclaration" &&
        kind !== "KindInterfaceDeclaration" &&
        kind !== "KindTypeAliasDeclaration" &&
        kind !== "KindEnumDeclaration" &&
        kind !== "KindImportDeclaration" &&
        kind !== "KindExportDeclaration" &&
        kind !== "KindEndOfFile";
    });
    if (runtimeStatements.some(expressionRegionIsFallible)) {
      walk.context.facts.set(sourceFile, rustFallibleFactKey, { fallible: true }, [
        { message: "rust fallible project module initialization" },
      ]);
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        const body = ast.body(node);
        if (operation?.kind === "closure" && body !== undefined && expressionRegionIsFallible(body)) {
          if (rustCallableProtocol(operation.resultCarrier) !== undefined) {
            walk.context.facts.set(node, rustFallibleFactKey, { fallible: true }, [
              { message: "rust fallible first-class callable implementation" },
            ]);
          } else if (!ownedCallbackClosures.has(node)) {
            appendRustDiagnostic(
              walk,
              "RUST_FALLIBLE_CLOSURE_UNSUPPORTED",
              "Native Rust closures cannot contain fallible operations without an exact fallible callback ABI.",
              node,
              ["target.capability=rust.closure.exact-result"],
            );
          }
        }
      } else if (kind === KindPropertyAccessExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        const selected = walk.context.facts.get(node, rustSelectedOperationKey) ??
          walk.context.facts.resolve(node, rustSelectedOperationKey);
        if (operation?.kind === "source-accessor") {
          const readDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedReadDeclaration,
            walk.context.ast,
          );
          const writeDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedWriteDeclaration,
            walk.context.ast,
          );
          walk.context.facts.set(node, rustSourceAccessorEffectsFactKey, {
            ...(operation.read === undefined || readDeclaration === undefined
              ? {}
              : { read: fallible.has(readDeclaration) ? "fallible" : "infallible" }),
            ...(operation.write === undefined || writeDeclaration === undefined
              ? {}
              : { write: fallible.has(writeDeclaration) ? "fallible" : "infallible" }),
          }, [{ message: "rust finalized selected project accessor effects" }]);
        }
      } else if (kind === KindCallExpression || kind === KindNewExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        if (operation?.kind === "source-call") {
          const declaration = selectedProjectDeclaration(node);
          const runtimeCallable = (operation.target.form === "callable" &&
              rustCallableProtocol(operation.target.carrier) !== undefined) ||
            operation.target.form === "structural-method" &&
              rustCallableProtocol(operation.target.callableCarrier) !== undefined;
          if (runtimeCallable || declaration !== undefined) {
            const isAsync = rustFutureOutputCarrier(operation.resultCarrier) !== undefined;
            const isFallible = declaration !== undefined && fallible.has(declaration);
            walk.context.facts.set(node, rustSourceCallEffectsFactKey, {
              invocation: runtimeCallable || isFallible && !isAsync
                ? "fallible"
                : "infallible",
              awaiting: isAsync
                ? runtimeCallable || isFallible ? "fallible" : "infallible"
                : "not-applicable",
            }, [{ message: "rust finalized selected project-source call effects" }]);
          }
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child);
        }
      });
    };
    visit(sourceFile);
  }
}
