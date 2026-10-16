import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { Node_Expression, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustPromiseBodies, RustPromiseBodyDeclaration } from "../../target-model/records/callables-and-resources.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFutureTargetType } from "../../target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";

type SourceCall = Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;

export interface RustPromiseBodySelection {
  readonly plan: RustPromiseBodies;
  expose(declaration: Node, demand: Node): void;
  invocation(context: RustAnalysisContext, call: Node, declaration: Node, target: SourceCall["target"],
    resultCarrier: TargetTypeRef): SourceCall["asyncBody"] | undefined;
  seal(context: RustAnalysisContext): void;
}

export function createRustPromiseBodySelection(): RustPromiseBodySelection {
  const declarations = new Map<Node, RustPromiseBodyDeclaration>();
  const demands = new Map<Node, Node>();
  const objects = new Map<Node, Node>();
  let closed = false;
  const assertOpen = (): void => {
    if (closed) failTargetAnalysisInvariant("tsonic-rust", "Promise body selection is closed.");
  };
  return Object.freeze({
    plan: Object.freeze({ declarations, objects }),
    expose(declaration: Node, demand: Node): void {
      assertOpen();
      if (!demands.has(declaration)) demands.set(declaration, demand);
    },
    invocation(context: RustAnalysisContext, call: Node, declaration: Node, target: SourceCall["target"],
      resultCarrier: TargetTypeRef): SourceCall["asyncBody"] | undefined {
      assertOpen();
      const asynchronous = context.records.asyncFunction.get(declaration);
      if (asynchronous?.kind !== "js-promise") return undefined;
      const use = context.promiseResultUses.get(call);
      if (use === undefined) failTargetAnalysisInvariant("tsonic-rust", "A source async invocation requires its original result-use selection.", call);
      const operand = use.kind === "awaited-in-scope" ? Node_Expression(context.ast, use.use) : undefined;
      const immediate = operand !== undefined && rustUnparenthesizedExpression(context.ast, operand) === call;
      const name = context.names.nativeBodyNameForDeclaration(declaration);
      const stable = !context.source.navigation.declarationUseSummary(declaration).bindingWritten &&
        (!context.ast.is.IsMethodDeclaration(declaration) || context.projectMethodProperties.usageFor(declaration)?.writable !== true);
      const selectedIdentities = context.sourcePackageComponentIdentities;
      if (selectedIdentities.kind === "rejected") failTargetAnalysisInvariant("tsonic-rust",
        "Promise body selection requires validated source-package component identities.", call);
      const callerFile = context.ast.getSourceFile(call);
      const calleeFile = context.ast.getSourceFile(declaration);
      const callerComponent = callerFile === undefined ? undefined
        : selectedIdentities.identities.componentIdForFile(context.ast.getFileName(callerFile));
      const calleeComponent = calleeFile === undefined ? undefined
        : selectedIdentities.identities.componentIdForFile(context.ast.getFileName(calleeFile));
      if (callerComponent === undefined || calleeComponent === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A source Promise invocation requires exact caller and declaration component identities.", call);
      if (immediate && stable && name !== undefined && (target.form === "function" || target.form === "static-method" ||
        target.form === "method" && target.dispatch === undefined) && callerComponent === calleeComponent &&
        rustJsPromiseOutputTargetType(resultCarrier) !== undefined) {
        return Object.freeze({ declaration, targetName: name, logicalResultCarrier: resultCarrier,
          maySuspend: asynchronous.lowering.kind === "factory" });
      }
      if (!demands.has(declaration)) demands.set(declaration, call);
      return undefined;
    },
    seal(context: RustAnalysisContext): void {
      assertOpen();
      for (const declaration of context.sourceStorage.nodes) {
        const asynchronous = context.records.asyncFunction.get(declaration);
        if (asynchronous?.kind !== "js-promise") continue;
        const name = context.names.nativeBodyNameForDeclaration(declaration);
        const demand = demands.get(declaration) ??
          (name === undefined || context.runtimeValueUses.hasFirstClassUse(declaration) ? declaration : undefined);
        if (demand !== undefined) objects.set(declaration, demand);
        if (name === undefined) continue;
        declarations.set(declaration, Object.freeze({ name,
          visibility: context.ast.is.IsFunctionDeclaration(declaration) &&
            !sourceDeclarationIsModuleScoped(declaration, context.ast) ? "private" : "crate" }));
      }
      closed = true;
    },
  });
}

export function rustPromiseBodyInvocationCarrier(body: NonNullable<SourceCall["asyncBody"]>): TargetTypeRef {
  const output = rustJsPromiseOutputTargetType(body.logicalResultCarrier);
  if (output === undefined) failTargetAnalysisInvariant("tsonic-rust", "A selected Promise body requires its exact completion payload.", body.declaration);
  return rustFutureTargetType(output);
}
