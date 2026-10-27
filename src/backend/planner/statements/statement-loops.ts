import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import {
  planExpression,
} from "../expressions/index.js";
import {
  ForInOrOfStatement_Statement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planResourceManagedBody, resourceDisposalReceiverMode, resourceFactForPlanning } from "./resource-management.js";
import { createRustLoopTarget, withRustControlTarget } from "./loop-regions.js";
import { registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planBlockLike } from "./planning.js";
import { planRustBindingPattern } from "../bindings/binding-patterns.js";
import { rustBindingLivenessAttributes } from "../bindings/liveness.js";
import { planRustModuleBindingStore, planRustPromotedStorageWrite } from "../expressions/typed-locations.js";
import { planRustDirectStorage } from "../expressions/update-target.js";
import { planRustRuntimeSetExpression } from "../expressions/runtime-setters.js";
import { planRustSourceErrorPropagation } from "../expressions/calls/source-errors.js";

import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustIterationBindingCompletion } from "../../../target-model/records/operations/statement-completion.js";

export function planRuntimeSetStatement(
  expression: Node,
  fact: Extract<import("../../../target-model/records/operations/operations.js").RustTargetOperationFact, { kind: "runtime-set" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  return [{ kind: "expr", expr: planRustRuntimeSetExpression(expression, fact, context) }];
}

export function planForOfStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const fact = context.input.program.records.targetOperation.get(node);
  const completion = context.input.program.records.iterationCompletion.get(node);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind === "for-in") {
    failRustPlannerInvariant("for-of requires its admitted native iteration selection.", node);
  }
  if (completion === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("for-of requires its admitted binding and native name frame.", node);
  const selectedBinding = completion.binding;
  const bindingDeclaration = selectedBinding.kind === "declaration" ? selectedBinding.declaration : undefined;
  const bindingPattern = selectedBinding.kind === "pattern" ? selectedBinding.pattern : undefined;
  const binding = selectedBinding.kind === "declaration" ? selectedBinding.name
    : allocateRustSyntheticName(context.syntheticNames, "binding_element");
  const iterableNode = Node_Expression(context.input.program.source.ast, node);
  const borrowedIterable = fact.lowering.kind === "borrowed" && fact.lowering.input === "reference" || fact.lowering.kind === "js-array";
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context, "value", borrowedIterable ? "shared-reference" : "value");
  if (iterable === undefined) {
    failRustPlannerInvariant("An admitted iteration requires its native collection value plan.", node);
  }
  const bodyNode = ForInOrOfStatement_Statement(context.input.program.source.ast, node);
  if (bodyNode === undefined) {
    failRustPlannerInvariant(
      "for-of statements require a concrete source body.",
      node,
    );
  }
  const target = createRustLoopTarget(context, node, []);
  const resourceBinding = completion.resource !== undefined;
  const resourceFact = completion.resource !== undefined
    ? resourceFactForPlanning(completion.resource, context)
    : undefined;
  if (resourceBinding && resourceFact === undefined) {
    failRustPlannerInvariant("An admitted resource iteration requires its native disposal fact.", node);
  }
  const borrowedBinding = resourceBinding || bindingPattern !== undefined ? undefined
    : context.input.program.records.borrowedIterationBinding.get(node);
  const expressionOverrides = borrowedBinding === undefined ? undefined : new Map(context.expressionOverrides);
  if (borrowedBinding !== undefined && expressionOverrides !== undefined) {
    for (const reference of borrowedBinding.references) expressionOverrides.set(reference, {
      carrier: fact.elementCarrier,
      valueForm: "shared-reference",
      expression: { kind: "path", path: binding },
    });
  }
  const bodyContext = expressionOverrides === undefined ? context : { ...context, expressionOverrides };
  let body = resourceFact === undefined || bindingDeclaration === undefined
    ? planBlockLike(
        bodyNode,
        withRustControlTarget(bodyContext, target),
      )
    : (() => {
        const resourceScope = planResourceManagedBody(
          bindingDeclaration,
          binding,
          resourceFact,
          context,
          (bodyContext) => planBlockLike(
            bodyNode,
            withRustControlTarget(bodyContext, target),
          ),
        );
        return resourceScope === undefined
          ? undefined
          : { statements: [resourceScope] };
      })();
  if (body === undefined) {
    failRustPlannerInvariant("An admitted iteration requires its native body plan.", bodyNode);
  }
  if (bindingPattern !== undefined) {
    const bindings = planRustBindingPattern(
      bindingPattern,
      { kind: "path", path: binding },
      fact.elementCarrier,
      context,
      planExpression,
    );
    if (bindings === undefined) {
      failRustPlannerInvariant("An admitted iteration pattern requires its native bindings.", bindingPattern);
    }
    body = { statements: [...bindings, ...body.statements] };
  }
  if (selectedBinding.kind === "assignment") {
    const activation = activateIterationBinding(selectedBinding, { kind: "path", path: binding }, context);
    if (activation === undefined) failRustPlannerInvariant("An admitted iteration assignment requires its native binding activation.", node);
    body = { statements: [...activation, ...body.statements] };
  }
  const bindingMutable = selectedBinding.kind === "declaration" && selectedBinding.mutable ||
    resourceFact !== undefined && resourceDisposalReceiverMode(resourceFact) === "mut-ref";
  const generatorBody = fact.lowering.kind === "sync-generator" || fact.lowering.kind === "async-generator"
    ? context.input.program.records.sourceErrorEffects.get(node)?.edges : undefined;
  if ((fact.lowering.kind === "sync-generator" || fact.lowering.kind === "async-generator") && generatorBody?.length !== 1)
    failRustPlannerInvariant("An admitted generator iteration requires its one selected original body error channel.", node);
  if (fact.lowering.kind === "async-generator") {
    if (context.asyncContext !== true || context.syntheticNames === undefined) {
      failRustPlannerInvariant("Admitted async iteration requires its native execution and name frame.", node);
    }
    const iteratorName = allocateRustSyntheticName(context.syntheticNames, "async_iterator");
    const next: RustExpr = {
      kind: "await",
      expr: {
        kind: "method-call",
        receiver: { kind: "path", path: iteratorName },
        method: "next_yield",
        args: [],
      },
    };
    const nextValue = planRustSourceErrorPropagation(node, generatorBody![0]!, next, context);
    if (nextValue === undefined) failRustPlannerInvariant("An admitted async generator requires its exact native Result consumption.", node);
    return [{
      kind: "scope",
      body: {
        statements: [
          { kind: "let", name: iteratorName, mutable: false, init: iterable },
          {
            kind: "while-let-some",
            ...(target.used.value ? { label: target.label } : {}),
            binding,
            ...(bindingMutable ? { bindingMutable: true } : {}),
            expression: nextValue,
            body,
          },
        ],
      },
    }];
  }
  if (fact.lowering.kind === "borrowed" && borrowedBinding === undefined) {
    context.usedAliases?.add("rt");
  }
  if (fact.lowering.kind === "owned-call") {
    registerAliasFromPath(context, fact.lowering.path);
  }
  const targetIterable: RustExpr = borrowedBinding !== undefined
    ? { kind: "method-call", receiver: iterable, method: "iter", args: [] }
    : fact.lowering.kind === "borrowed"
    ? {
        kind: "call",
        path: `rt::iter_${fact.lowering.style}`,
        args: [fact.lowering.input === "reference"
          ? iterable
          : iterable],
      }
    : fact.lowering.kind === "js-array"
      // A method receiver is auto-borrowed; an explicit `&` on the shared iterable is clippy::needless_borrow.
      ? { kind: "method-call", receiver: iterable.kind === "reference" ? iterable.expr : iterable, method: "iter_values", args: [] }
      : fact.lowering.kind === "receiver-method"
        ? { kind: "method-call", receiver: iterable, method: fact.lowering.name, args: [] }
      : fact.lowering.kind === "owned-call"
        ? { kind: "call", path: fact.lowering.path, args: [iterable] }
      : fact.lowering.kind === "fallible-owned"
        ? { kind: "method-call", receiver: iterable, method: "iterator", args: [] }
      : iterable;
  let loopBinding = binding;
  let loopBindingMutable = bindingMutable;
  if (fact.lowering.kind === "sync-generator") {
    loopBinding = allocateRustSyntheticName(context.syntheticNames, "generator_item");
    loopBindingMutable = false;
    const value = planRustSourceErrorPropagation(node, generatorBody![0]!, { kind: "path", path: loopBinding }, context);
    if (value === undefined) failRustPlannerInvariant("An admitted generator requires its exact native Result consumption.", node);
    body = { statements: [{ kind: "let", name: binding, mutable: bindingMutable, init: value }, ...body.statements] };
  } else if (fact.lowering.kind === "fallible-owned") {
    const activeErrorType = rustActiveErrorType(context);
    if (context.syntheticNames === undefined || activeErrorType === undefined) {
      failRustPlannerInvariant("Admitted fallible iteration requires its native error and name frame.", node);
    }
    loopBinding = allocateRustSyntheticName(context.syntheticNames, "fallible_item");
    loopBindingMutable = false;
    const item = rustPropagateLocalError(context.fallibleBoundary!, { kind: "named", path: "js_abi::JsError" },
      { kind: "path", path: loopBinding });
    if (item === undefined) failRustPlannerInvariant("An admitted fallible iteration requires its native error transport.", node);
    body = {
      statements: [
        {
          kind: "let",
          name: binding,
          mutable: bindingMutable,
          init: item,
        },
        ...body.statements,
      ],
    };
  }
  return [{
    kind: "for",
    ...(bindingDeclaration === undefined || resourceBinding ? {} : {
      attrs: rustBindingLivenessAttributes(bindingDeclaration, false, context),
    }),
    ...(target.used.value ? { label: target.label } : {}),
    binding: loopBinding,
    ...(loopBindingMutable ? { bindingMutable: true } : {}),
    iterable: targetIterable,
    body,
  }];
}

export function planForInStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.records.targetOperation.get(node);
  const completion = context.input.program.records.iterationCompletion.get(node);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind !== "for-in" ||
    (fact.lowering.kind !== "dense-index-keys" && fact.lowering.kind !== "js-array-index-keys" &&
      fact.lowering.kind !== "static-keys" && fact.lowering.kind !== "record-keys")) {
    failRustPlannerInvariant("for-in requires its admitted native property-key iteration selection.", node);
  }
  if (completion === undefined || completion.binding.kind === "pattern") failRustPlannerInvariant("for-in requires its admitted key binding.", node);
  const binding = completion.binding;
  const expressionNode = Node_Expression(ast, node);
  const expression = expressionNode === undefined ? undefined : planExpression(expressionNode, context);
  const bodyNode = ForInOrOfStatement_Statement(ast, node);
  if (bodyNode === undefined || expressionNode === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("for-in requires its checked source body, receiver and native name frame.", node);
  if (expression === undefined) failRustPlannerInvariant("An admitted property-key iteration requires its collection value plan.", node);
  const target = createRustLoopTarget(context, node, []);
  const body = planBlockLike(bodyNode, withRustControlTarget(context, target));
  if (fact.lowering.kind === "dense-index-keys") {
    const lengthName = allocateRustSyntheticName(context.syntheticNames, "for_in_length");
    const indexName = allocateRustSyntheticName(context.syntheticNames, "for_in_index");
    const activation = activateIterationBinding(binding, {
      kind: "method-call",
      receiver: { kind: "path", path: indexName },
      method: "to_string",
      args: [],
    }, context);
    if (activation === undefined) failRustPlannerInvariant("An admitted property-key iteration requires its native binding activation.", node);
    return [{
      kind: "scope",
      body: {
        statements: [
          {
            kind: "let",
            name: lengthName,
            mutable: false,
            init: {
              kind: "method-call",
              receiver: expression,
              method: "len",
              args: [],
            },
          },
          {
            kind: "for",
            ...(target.used.value ? { label: target.label } : {}),
            binding: indexName,
            iterable: {
              kind: "range",
              start: { kind: "int-literal", text: "0" },
              end: { kind: "path", path: lengthName },
            },
            body: { statements: [...activation, ...body.statements] },
          },
        ],
      },
    }];
  }
  const keyName = binding.kind === "declaration"
    ? binding.name
    : allocateRustSyntheticName(context.syntheticNames, "for_in_key");
  const activation = binding.kind === "assignment"
    ? activateIterationBinding(binding, { kind: "path", path: keyName }, context)
    : [];
  if (activation === undefined) failRustPlannerInvariant("An admitted property-key iteration requires its native binding activation.", node);
  const iterable: RustExpr = fact.lowering.kind === "js-array-index-keys" || fact.lowering.kind === "record-keys"
    ? {
        kind: "method-call",
        receiver: expression,
        method: fact.lowering.kind === "record-keys" ? "keys" : "enumerable_own_keys",
        args: [],
      }
    : {
        kind: "slice-literal",
        elements: fact.lowering.keys.map((key) => ({ kind: "string-literal", value: key })),
      };
  return [{
    kind: "scope",
    body: {
      statements: [
        ...(fact.lowering.kind === "static-keys"
          ? [{ kind: "let" as const, name: "_", mutable: false, init: { kind: "reference" as const, expr: expression } }]
          : []),
        {
          kind: "for",
          ...(target.used.value ? { label: target.label } : {}),
          binding: keyName,
          ...(binding.kind === "declaration" && binding.mutable ? { bindingMutable: true } : {}),
          iterable,
          body: { statements: [...activation, ...body.statements] },
        },
      ],
    },
  }];
}

function activateIterationBinding(
  binding: Exclude<RustIterationBindingCompletion, { readonly kind: "pattern" }>,
  value: RustExpr,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (binding.kind === "declaration") {
    return [{ kind: "let", name: binding.name, mutable: binding.mutable, init: value }];
  }
  const moduleStore = planRustModuleBindingStore(binding.reference, value, context);
  if (moduleStore !== undefined) return [{ kind: "expr", expr: moduleStore }];
  const promoted = planRustPromotedStorageWrite(binding.reference, "=", value, context, planExpression);
  if (promoted.handled) {
    if (promoted.statement === undefined) failRustPlannerInvariant("An admitted iteration assignment requires its promoted storage write.", binding.reference);
    return [promoted.statement];
  }
  const target = planRustDirectStorage(binding.reference, context);
  if (target === undefined) failRustPlannerInvariant("An admitted iteration assignment requires its native destination.", binding.reference);
  return [{
    kind: "assign",
    target,
    operator: "=",
    value,
  }];
}
