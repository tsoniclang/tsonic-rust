import { createRustPromiseBodyProducer } from "../../program/records/callables/promise-bodies.js";
import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceDeclarationIsModuleScoped, sourceImmediatelyAwaitedLocal } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../../program/context.js";
import type { RustPromiseBodies } from "../../../target-model/records/callables/callables-and-resources.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustFutureTargetType } from "../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";
import { rustUnparenthesizedExpression } from "../../../target-model/syntax/expressions.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { selectRustPromiseBodyRecursion } from "./promise-recursion.js";
import type { RustModuleBindingAnalysis } from "../../program/module-bindings.js";
import { rustCallableExpressionValueDeclaration } from "../values/function-values.js";

type SourceCall = Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;

export interface RustPromiseBodySelection {
  readonly plan: RustPromiseBodies;
  readonly namesReady: boolean;
  initializeNames(context: RustAnalysisContext, modules: RustModuleBindingAnalysis): void;
  nativeNameForDeclaration(declaration: Node | undefined): string | undefined;
  nativeFormForDeclaration(declaration: Node): "function" | "method" | "static-method" | undefined;
  namesForScope(scope: Node): ReadonlySet<string>;
  expose(declaration: Node, demand: Node): void;
  invocation(context: RustAnalysisContext, call: Node, declaration: Node, target: SourceCall["target"],
    resultCarrier: TargetTypeRef): SourceCall["asyncBody"] | undefined;
  seal(context: RustAnalysisContext): void;
}

export function createRustPromiseBodySelection(): RustPromiseBodySelection {
  const demands = new Map<Node, Set<Node>>();
  const nativeDeclarations = new Map<Node, {
    readonly name: string; readonly form: "function" | "method" | "static-method";
  }>();
  const scopeNames = new Map<Node, Set<string>>();
  let namesReady = false;
  let closed = false;
  const assertOpen = (): void => {
    if (closed) failTargetAnalysisInvariant("tsonic-rust", "Promise body selection is closed.");
  };
  const producer = createRustPromiseBodyProducer(assertOpen);
  const recordDemand = (declaration: Node, demand: Node): void => {
    const selected = demands.get(declaration) ?? new Set<Node>();
    selected.add(demand);
    demands.set(declaration, selected);
  };
  return Object.freeze({
    plan: producer.records,
    get namesReady() { return namesReady; },
    initializeNames(context: RustAnalysisContext, modules: RustModuleBindingAnalysis): void {
      assertOpen();
      if (namesReady) failTargetAnalysisInvariant("tsonic-rust", "Native Promise names have one physical-scope producer.");
      const usedIn = (scope: Node): Set<string> => {
        const existing = scopeNames.get(scope);
        if (existing !== undefined) return existing;
        const names = new Set<string>();
        scopeNames.set(scope, names);
        return names;
      };
      for (const declaration of context.nativeNodes) {
        const scope = context.names.sourceScopeForDeclaration(declaration);
        if (scope !== undefined) {
          for (const name of [context.names.nameForDeclaration(declaration),
            context.names.functionNameForDeclaration(declaration), context.names.callableValueNameForDeclaration(declaration)]) {
            if (name !== undefined) usedIn(scope).add(name);
          }
        }
        const staticSlot = context.projectTypes.memberSlotName(declaration, "static");
        const sourceFile = context.ast.getSourceFile(declaration);
        if (staticSlot !== undefined && sourceFile !== undefined) usedIn(sourceFile).add(staticSlot);
      }
      if (context.jsEnabled) for (const namedDeclaration of context.nativeNodes) {
        const module = context.ast.is.IsVariableDeclaration(namedDeclaration) ? modules.nativeCallable(namedDeclaration) : undefined;
        const declaration = module?.callableDeclaration ?? namedDeclaration;
        if ((module === undefined && !context.ast.is.IsFunctionDeclaration(declaration) && !context.ast.is.IsMethodDeclaration(declaration)) ||
          !context.ast.hasModifierKind(declaration, "async") || context.ast.body(declaration) === undefined) continue;
        if (context.ast.is.IsMethodDeclaration(declaration)) {
          const parent = context.ast.parent(declaration);
          if (parent === undefined || !context.ast.is.IsClassDeclaration(parent) && !context.ast.is.IsClassExpression(parent)) continue;
          const owner = context.projectTypes.definitionContainingDeclaration(declaration);
          if (owner === undefined || !context.ast.hasModifierKind(declaration, "static") && context.projectTypes.isPolymorphic(owner)) continue;
        }
        const staticSlot = context.projectTypes.memberSlotName(declaration, "static");
        const scope = staticSlot === undefined ? context.names.sourceScopeForDeclaration(namedDeclaration)
          : context.ast.getSourceFile(declaration);
        const name = module !== undefined ? module.name : staticSlot !== undefined ? staticSlot : context.ast.is.IsFunctionDeclaration(declaration)
          ? context.names.functionNameForDeclaration(declaration) : context.names.nameForDeclaration(declaration);
        if (scope === undefined || name === undefined) continue;
        const base = name.startsWith("r#") ? name.slice(2) : name;
        const form = module !== undefined || context.ast.is.IsFunctionDeclaration(declaration) || staticSlot !== undefined ? "function"
          : context.ast.hasModifierKind(declaration, "static") ? "static-method" : "method";
        nativeDeclarations.set(declaration, Object.freeze({ name: allocateRustGeneratedName(usedIn(scope), `${base}_native`), form }));
      }
      namesReady = true;
    },
    nativeNameForDeclaration: (declaration: Node | undefined) => declaration === undefined ? undefined : nativeDeclarations.get(declaration)?.name,
    nativeFormForDeclaration: (declaration: Node) => nativeDeclarations.get(declaration)?.form,
    namesForScope: (scope: Node) => scopeNames.get(scope) ?? emptyScopeNames,
    expose(declaration: Node, demand: Node): void {
      assertOpen();
      recordDemand(declaration, demand);
    },
    invocation(context: RustAnalysisContext, call: Node, declaration: Node, target: SourceCall["target"],
      resultCarrier: TargetTypeRef): SourceCall["asyncBody"] | undefined {
      assertOpen();
      const asynchronous = context.records.asyncFunction.get(declaration);
      if (asynchronous?.kind !== "js-promise") return undefined;
      const name = rustPromiseBodyNativeName(context, declaration);
      if (rustDirectPromiseBodyCallee(context, call, resultCarrier) === declaration && name !== undefined) {
        if (target.form !== context.promiseBodies.nativeFormForDeclaration(declaration) ||
          target.form === "method" && target.dispatch !== undefined) failTargetAnalysisInvariant("tsonic-rust",
          "The selected native Promise edge conflicts with its physical invocation form.", call);
        return Object.freeze({ declaration, targetName: name, logicalResultCarrier: resultCarrier,
          maySuspend: asynchronous.lowering.kind === "factory" });
      }
      for (const targetDeclaration of target.form === "union-method" ? target.variants.map(variant => variant.declaration) : [declaration])
        recordDemand(targetDeclaration, call);
      return undefined;
    },
    seal(context: RustAnalysisContext): void {
      assertOpen();
      const recursion = selectRustPromiseBodyRecursion(context, createSourceStorageBudget(defaultSourceStorageLimits));
      if (recursion.kind === "unresolved") {
        context.diagnostics.push(Object.freeze({ code: "RUST_ASYNC_BODY_RECURSION_NOT_CLOSED", category: "error",
          source: "tsonic-rust", sourceNode: recursion.at, message: recursion.reason,
          evidence: ["target.capability=rust.async.native-body-layout"] }));
        return;
      }
      for (const [declaration, entries] of recursion.invocations) producer.pinned(declaration, entries);
      for (const declaration of context.nativeNodes) {
        const asynchronous = context.records.asyncFunction.get(declaration);
        if (asynchronous?.kind !== "js-promise") continue;
        const name = rustPromiseBodyNativeName(context, declaration);
        const selectedDemands = new Set(demands.get(declaration));
        const binding = rustCallableExpressionValueDeclaration(declaration, context.ast);
        const methodOwner = context.ast.is.IsMethodDeclaration(declaration)
          ? context.projectTypes.definitionContainingDeclaration(declaration) : undefined;
        const exportedMethod = methodOwner?.kind === "class" &&
          !context.ast.hasModifierKind(declaration, "private") && !context.ast.hasModifierKind(declaration, "protected") &&
          sourceDeclarationIsModuleScoped(methodOwner.declaration, context.ast) &&
          context.source.navigation.declarationUseSummary(methodOwner.declaration).exported;
        if (name === undefined || context.runtimeValueUses.hasFirstClassUse(binding ?? declaration) ||
          context.sourceBoundaries.publishedDeclarations.has(declaration) || exportedMethod ||
          binding !== undefined && sourceDeclarationIsModuleScoped(binding, context.ast) &&
          context.source.navigation.declarationUseSummary(binding).exported ||
          context.ast.is.IsFunctionDeclaration(declaration) && context.ast.hasModifierKind(declaration, "export") &&
          sourceDeclarationIsModuleScoped(declaration, context.ast))
          selectedDemands.add(declaration);
        if (selectedDemands.size > 0) producer.object(declaration, Object.freeze([...selectedDemands].sort((left, right) => {
          const leftFile = context.ast.getSourceFile(left);
          const rightFile = context.ast.getSourceFile(right);
          const leftName = leftFile === undefined ? "" : context.ast.getFileName(leftFile);
          const rightName = rightFile === undefined ? "" : context.ast.getFileName(rightFile);
          return leftName.localeCompare(rightName, "en") || context.ast.pos(left) - context.ast.pos(right);
        })));
        if (name === undefined) continue;
        producer.declaration(declaration, Object.freeze({ name,
          visibility: context.ast.is.IsFunctionDeclaration(declaration) &&
            !sourceDeclarationIsModuleScoped(declaration, context.ast) ? "private" : "crate" }));
      }
      closed = true;
    },
  });
}

const emptyScopeNames: ReadonlySet<string> = new Set();

export function rustDirectPromiseBodyCallee(context: RustAnalysisContext, operand: Node, resultCarrier: TargetTypeRef): Node | undefined {
  if (rustJsPromiseOutputTargetType(resultCarrier) === undefined) return undefined;
  const { ast } = context;
  const call = rustUnparenthesizedExpression(ast, operand);
  if (!ast.is.IsCallExpression(call) || ast.as.AsCallExpression(call)?.QuestionDotToken !== undefined) return undefined;
  if (context.records.optionalChain.get(call) !== undefined) return undefined;
  const use = context.promiseResultUses.get(call);
  const awaited = use?.kind === "awaited-in-scope" ? Node_Expression(ast, use.use) : undefined;
  if ((awaited === undefined || rustUnparenthesizedExpression(ast, awaited) !== call) &&
    !sourceImmediatelyAwaitedLocal(ast, context.source.navigation, call)) return undefined;
  const expression = Node_Expression(ast, call);
  const callee = expression === undefined ? undefined : rustUnparenthesizedExpression(ast, expression);
  if (callee === undefined) return undefined;
  const semantics = context.semanticsFor(call);
  const checked = semantics.operations.call(call);
  const signature = checked === undefined ? undefined : semantics.declarations.signatureDeclaration(checked.selectedSignature);
  const implementation = signature === undefined ? undefined : context.source.navigation.callableImplementation(signature);
  const declaration = implementation?.kind === "resolved" ? implementation.implementation.declaration : undefined;
  const valueBinding = declaration === undefined ? undefined : rustCallableExpressionValueDeclaration(declaration, ast);
  if (declaration === undefined || ast.body(declaration) === undefined || !ast.hasModifierKind(declaration, "async") ||
    !context.source.navigation.isProjectDeclaration(declaration) ||
    context.source.navigation.declarationUseSummary(valueBinding ?? declaration).bindingWritten ||
    rustPromiseBodyNativeName(context, declaration) === undefined) return undefined;
  if (ast.is.IsFunctionDeclaration(declaration)) {
    const reference = context.source.navigation.sourceReferenceFor(callee)?.declaration;
    const referencedBody = reference === undefined ? undefined : context.source.navigation.callableImplementation(reference);
    const binding = reference === undefined ? undefined : context.records.moduleBinding.get(reference);
    const lexical = context.sourceCallables.directLexicalBinding(declaration);
    if (reference !== declaration &&
      !(referencedBody?.kind === "resolved" && referencedBody.implementation.declaration === declaration) &&
      !(lexical !== undefined && lexical === reference) &&
      !(reference !== undefined && context.runtimeValueUses.callAliasTarget(reference) === declaration) &&
      !(binding?.storage === "native-callable" && binding.callableDeclaration === declaration)) return undefined;
  } else if (valueBinding !== undefined) {
    const reference = context.source.navigation.sourceReferenceFor(callee)?.declaration;
    const binding = reference === undefined ? undefined : context.records.moduleBinding.get(reference);
    if (reference !== valueBinding &&
      !(reference !== undefined && context.runtimeValueUses.callAliasTarget(reference) === declaration) &&
      !(binding?.storage === "native-callable" && binding.callableDeclaration === declaration)) return undefined;
  } else if (ast.is.IsMethodDeclaration(declaration) && ast.is.IsPropertyAccessExpression(callee)) {
    const access = semantics.operations.propertyAccess(callee);
    const receiverType = access === undefined ? undefined : semantics.types.expressionType(access.receiver.expression);
    if (access === undefined || receiverType === undefined || semantics.types.isUnion(receiverType)) return undefined;
    if (context.projectMethodProperties.usageFor(declaration)?.writable === true) return undefined;
  } else return undefined;
  const identities = context.sourcePackageComponentIdentities;
  if (identities.kind === "rejected") return undefined;
  const callerFile = ast.getSourceFile(call);
  const calleeFile = ast.getSourceFile(declaration);
  const callerComponent = callerFile === undefined ? undefined : identities.identities.componentIdForFile(ast.getFileName(callerFile));
  const calleeComponent = calleeFile === undefined ? undefined : identities.identities.componentIdForFile(ast.getFileName(calleeFile));
  if (callerComponent === undefined || calleeComponent === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "A native Promise edge requires both exact validated source-package component identities.", call);
  return callerComponent === calleeComponent ? declaration : undefined;
}

export function rustPromiseBodyInvocationCarrier(body: NonNullable<SourceCall["asyncBody"]>): TargetTypeRef {
  const output = rustJsPromiseOutputTargetType(body.logicalResultCarrier);
  if (output === undefined) failTargetAnalysisInvariant("tsonic-rust", "A selected Promise body requires its exact completion payload.", body.declaration);
  return body.maySuspend ? rustFutureTargetType(output) : output;
}

function rustPromiseBodyNativeName(context: RustAnalysisContext, declaration: Node): string | undefined {
  return context.promiseBodies.nativeNameForDeclaration(declaration);
}
