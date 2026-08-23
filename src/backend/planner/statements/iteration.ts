import {
  applyRustArgumentMode,
  planExpression,
  planFinalizedSourceInput,
  planFinalizedTargetInput,
} from "../expressions/index.js";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  KindIdentifier,
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  Node_Expression,
  Node_Name,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, planResourceManagedBody, resourceDisposalReceiverMode, resourceFactForPlanning } from "./resources.js";
import { createRustLoopTarget, withRustControlTarget } from "./control-flow.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { isRustJsStringCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { planRustNonConsumingValue } from "../expressions/typed-locations.js";
import { rustMutatedBindingFactKey, rustSourceBindingFactKey, rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { validateRustFinalizedOperationAbi } from "../../../analysis/facts/finalized-operation-abi.js";
import { planRustJsStringLiteral } from "../expressions/js-strings.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationFact } from "./core.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planRuntimeSetStatement(
  expression: Node,
  fact: Extract<import("../../../analysis/facts/keys.js").RustTargetOperationFact, { kind: "runtime-set" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const left = BinaryExpression_Left(context.input.program.source.ast, expression);
  const right = BinaryExpression_Right(context.input.program.source.ast, expression);
  if (left === undefined || right === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-shape",
      "Runtime setter fact requires concrete assignment target and value nodes.",
    ));
    return undefined;
  }
  const leftKind = ast.kindName(left);
  const expectedOperationKind = leftKind === "KindPropertyAccessExpression"
    ? "property-set"
    : leftKind === "KindElementAccessExpression"
      ? "index-set"
      : undefined;
  const indexNode = leftKind === "KindElementAccessExpression"
    ? ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, left)
    : undefined;
  const sourceArgumentNodes = indexNode === undefined ? [right] : [indexNode, right];
  if (!validateRustFinalizedOperationAbi(fact.abi) ||
    expectedOperationKind === undefined || fact.abi.operationKind !== expectedOperationKind ||
    (expectedOperationKind === "index-set" && indexNode === undefined) ||
    sourceArgumentNodes.length !== fact.abi.sourceArguments.length ||
    fact.abi.sourceArguments.some((argument) => argument.disposition !== "runtime") ||
    fact.abi.effects.invocation !== "infallible" || fact.abi.effects.awaiting !== "not-applicable" ||
    fact.abi.result.kind !== "sync" || !isRustUnitCarrier(fact.abi.result.carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-abi",
      "Runtime setter source shape, effects, and arguments do not match one valid total Rust setter ABI.",
    ));
    return undefined;
  }
  if (fact.abi.effects.safety === "requires-unsafe" &&
    (context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
      sourceNode: expression,
    });
    return undefined;
  }
  const selectedResult = context.input.program.facts.getRuntimeCarrierFact(right)?.carrier;
  if (selectedResult === undefined || !selectedOperatorIdentityMatches(
    expression,
    fact.operationId,
    fact.operationId,
    selectedResult,
    context,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-selected-evidence",
      "Runtime setter fact conflicts with the TSTS-selected assignment operation.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, left);
  const receiver = fact.abi.targetReceiver.kind === "input" && receiverNode !== undefined
    ? planFinalizedSourceInput(
        context,
        fact.abi.targetReceiver.input,
        receiverNode,
        sourceArgumentNodes,
        expression,
        "target-receiver",
      )
    : undefined;
  if (fact.abi.targetReceiver.kind === "input" && receiver === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-receiver",
      "Runtime setter ABI has no finalized target receiver input.",
    ));
    return undefined;
  }
  const targetArguments: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(context, input, receiverNode, sourceArgumentNodes, expression);
    if (planned === undefined) {
      return undefined;
    }
    targetArguments.push(planned);
  }
  if (fact.abi.target.form === "index") {
    const [index, value] = targetArguments;
    if (receiver === undefined || index === undefined || value === undefined ||
      targetArguments.length !== 2) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-index-set-abi",
        "Runtime index setter ABI must finalize exactly index and value target inputs.",
      ));
      return undefined;
    }
    return [{
      kind: "index-assign",
      receiver,
      index,
      value,
    }];
  }
  if (fact.abi.target.form === "static") {
    const [value] = targetArguments;
    if (receiver !== undefined || value === undefined || targetArguments.length !== 1) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-static-set-abi",
        "Runtime static setter ABI must finalize exactly one value and no target receiver.",
      ));
      return undefined;
    }
    registerAliasFromPath(context, fact.abi.target.path);
    return [{
      kind: "assign",
      target: { kind: "path", path: fact.abi.target.path },
      operator: "=",
      value,
    }];
  }
  if (fact.abi.target.form === "field") {
    const [value] = targetArguments;
    if (receiver === undefined || value === undefined || targetArguments.length !== 1) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-field-set-abi",
        "Runtime field setter ABI must finalize one receiver and one value.",
      ));
      return undefined;
    }
    return [{
      kind: "assign",
      target: { kind: "field", receiver, name: fact.abi.target.name },
      operator: "=",
      value,
    }];
  }
  if (fact.abi.target.form === "call" || fact.abi.target.form === "free-call" ||
    fact.abi.target.form === "call-str-slice" ||
    fact.abi.target.form === "free-call-str-slice" ||
    fact.abi.target.form === "call-ref-slice" ||
    fact.abi.target.form === "free-call-ref-slice" ||
    fact.abi.target.form === "call-value-slice" ||
    fact.abi.target.form === "call-value-array") {
    registerAliasFromPath(context, fact.abi.target.path);
    let call: RustExpr = {
      kind: "call",
      path: fact.abi.target.path,
      args: targetArguments,
    };
    if (fact.abi.target.form === "call") {
      for (const step of fact.abi.target.chain ?? []) {
        if (step.kind !== "method") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.runtime-set-chain",
            "Runtime setter call chain contains a non-method step after ABI validation.",
          ));
          return undefined;
        }
        call = { kind: "method-call", receiver: call, method: step.name, args: [] };
      }
    }
    return [{ kind: "expr", expr: call }];
  }
  if (fact.abi.target.form === "receiver-method" || fact.abi.target.form === "method" ||
    fact.abi.target.form === "arg-method" ||
    fact.abi.target.form === "arg-receiver-method" ||
    fact.abi.target.form === "receiver-value-array" ||
    fact.abi.target.form === "receiver-tagged-array") {
    if (receiver === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-set-receiver",
        "Runtime setter method form has no finalized target receiver input.",
      ));
      return undefined;
    }
    let call: RustExpr = {
      kind: "method-call",
      receiver,
      method: fact.abi.target.name,
      args: targetArguments,
      ...(fact.abi.targetReceiver.kind === "input"
        ? { receiverMode: fact.abi.targetReceiver.input.mode }
        : {}),
    };
    if (fact.abi.target.form === "receiver-method") {
      for (const step of fact.abi.target.chain ?? []) {
        if (step.kind !== "method") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.runtime-set-chain",
            "Runtime setter method chain contains a non-method step after ABI validation.",
          ));
          return undefined;
        }
        call = { kind: "method-call", receiver: call, method: step.name, args: [] };
      }
    }
    return [{
      kind: "expr",
      expr: call,
    }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, expression),
    "rust.js.assignment",
    "Runtime set operation form is not supported.",
  ));
  return undefined;
}

export function selectedOperatorMatches(
  expression: Node,
  fact: RustAssignmentOperationFact,
  context: RustPlanContext,
): boolean {
  return selectedOperatorIdentityMatches(expression, fact.operationId, fact.operator, fact.resultCarrier, context);
}

function selectedOperatorIdentityMatches(
  expression: Node,
  operationId: string,
  targetOperation: string,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): boolean {
  const selected = context.input.program.facts.getSelectedTargetOperator(expression);
  return selected !== undefined && selected.operationKind === "operator" &&
    selected.operationId === operationId && selected.targetOperation === targetOperation &&
    selected.resultType !== undefined && rustTargetTypeRefEquals(selected.resultType, resultCarrier);
}

export function planForOfStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind === "for-in") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of statements require a finalized iteration fact.",
    ));
    return undefined;
  }
  const selectedIteration = context.input.program.facts.getSelectedTargetIteration(node);
  if (selectedIteration === undefined || selectedIteration.operationKind !== "iteration" ||
    selectedIteration.operationId !== fact.operationId || selectedIteration.resultType === undefined ||
    !rustTargetTypeRefEquals(selectedIteration.resultType, fact.elementCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-selected-element",
      "Finalized Rust iteration fact conflicts with the TSTS-selected iteration element carrier.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(context.input.program.source.ast, node);
  const declarations = initializer === undefined
    ? []
    : collectVariableDeclarations(initializer, context);
  const bindingDeclaration = declarations.length === 1 ? declarations[0] : undefined;
  const bindingNameNode = bindingDeclaration === undefined
    ? undefined
    : Node_Name(context.input.program.source.ast, bindingDeclaration);
  const bindingNameKind = bindingNameNode === undefined ? "" : ast.kindName(bindingNameNode);
  const bindingPattern = bindingNameNode !== undefined &&
      (bindingNameKind === KindArrayBindingPattern || bindingNameKind === KindObjectBindingPattern)
    ? bindingNameNode
    : undefined;
  let binding = "";
  if (bindingNameNode !== undefined && bindingNameKind === KindIdentifier) {
    binding = context.input.program.names.nameForDeclaration(bindingDeclaration) ?? "";
  } else if (bindingPattern !== undefined && context.syntheticNames !== undefined) {
    binding = allocateRustSyntheticName(context.syntheticNames, "binding_element");
  }
  if (!isValidRustIdentifier(binding)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of bindings require an exact identifier or finalized binding pattern.",
    ));
    return undefined;
  }
  const iterableNode = Node_Expression(context.input.program.source.ast, node);
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context);
  if (iterable === undefined) {
    return undefined;
  }
  const bodyNode = ForInOrOfStatement_Statement(context.input.program.source.ast, node);
  if (bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-body",
      "for-of statements require a concrete source body.",
    ));
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const resourceKind = bindingDeclaration === undefined
    ? undefined
    : ast.variableDeclarationKind(bindingDeclaration);
  const resourceBinding = resourceKind === "using" || resourceKind === "await using";
  if (resourceBinding && bindingPattern !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bindingPattern),
      "rust.backend.resource-binding-pattern",
      "Resource-managed iteration binding patterns require an exact per-binding disposal contract.",
    ));
    return undefined;
  }
  const resourceFact = resourceBinding && bindingDeclaration !== undefined
    ? resourceFactForPlanning(bindingDeclaration, context)
    : undefined;
  if (resourceBinding && resourceFact === undefined) {
    return undefined;
  }
  let body = resourceFact === undefined || bindingDeclaration === undefined
    ? planBlockLike(
        bodyNode,
        withRustControlTarget(context, target),
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
    return undefined;
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
      return undefined;
    }
    body = { statements: [...bindings, ...body.statements] };
  }
  const bindingMutable = resourceFact !== undefined &&
    resourceDisposalReceiverMode(resourceFact) === "mut-ref";
  if (fact.lowering.kind === "async-generator") {
    if (context.asyncContext !== true || context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.async-iteration-context",
        "Async generator iteration requires a finalized async function context and hygienic local-name state.",
      ));
      return undefined;
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
            expression: next,
            body,
          },
        ],
      },
    }];
  }
  const nonConsumingIterable = iterableNode === undefined
    ? iterable
    : planRustNonConsumingValue(iterableNode, iterable, context);
  if (fact.lowering.kind === "borrowed") {
    context.usedAliases?.add("rt");
  }
  const targetIterable: RustExpr = fact.lowering.kind === "borrowed"
    ? {
        kind: "call",
        path: `rt::iter_${fact.lowering.style}`,
        args: [fact.lowering.input === "reference"
          ? applyRustArgumentMode(context, nonConsumingIterable, "ref", iterableNode)
          : nonConsumingIterable],
      }
    : fact.lowering.kind === "js-array"
      ? { kind: "method-call", receiver: nonConsumingIterable, method: "iter_values", args: [] }
      : fact.lowering.kind === "receiver-method"
        ? { kind: "method-call", receiver: nonConsumingIterable, method: fact.lowering.name, args: [] }
      : fact.lowering.kind === "fallible-owned"
        ? { kind: "method-call", receiver: nonConsumingIterable, method: "iterator", args: [] }
      : iterable;
  let loopBinding = binding;
  let loopBindingMutable = bindingMutable;
  if (fact.lowering.kind === "fallible-owned") {
    const activeErrorType = rustActiveErrorType(context);
    if (context.syntheticNames === undefined || activeErrorType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.fallible-iteration-context",
        "Fallible JavaScript iteration requires a finalized fallible context and hygienic local-name state.",
      ));
      return undefined;
    }
    loopBinding = allocateRustSyntheticName(context.syntheticNames, "fallible_item");
    loopBindingMutable = false;
    body = {
      statements: [
        {
          kind: "let",
          name: binding,
          mutable: bindingMutable,
          init: {
            kind: "try",
            resultErrorType: activeErrorType,
            operandErrorType: { kind: "named", path: "js_abi::JsError" },
            expr: { kind: "path", path: loopBinding },
          },
        },
        ...body.statements,
      ],
    };
  }
  return [{
    kind: "for",
    ...(target.used.value ? { label: target.label } : {}),
    binding: loopBinding,
    ...(loopBindingMutable ? { bindingMutable: true } : {}),
    iterable: targetIterable,
    body,
  }];
}

type PlannedForInBinding =
  | { readonly kind: "declaration"; readonly name: string; readonly mutable: boolean }
  | { readonly kind: "assignment"; readonly name: string };

export function planForInStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "iteration" || fact.iterationKind !== "for-in" ||
    (fact.lowering.kind !== "dense-index-keys" && fact.lowering.kind !== "js-array-index-keys" &&
      fact.lowering.kind !== "static-keys")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in",
      "for-in statements require one finalized property-key iteration policy.",
    ));
    return undefined;
  }
  const selectedIteration = context.input.program.facts.getSelectedTargetIteration(node);
  if (selectedIteration === undefined || selectedIteration.operationKind !== "iteration" ||
    selectedIteration.operationId !== fact.operationId || selectedIteration.resultType === undefined ||
    !rustTargetTypeRefEquals(selectedIteration.resultType, fact.elementCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-selected-key",
      "Finalized Rust property-key iteration conflicts with the TSTS-selected key carrier.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(ast, node);
  if (initializer === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-binding",
      "for-in requires one exact binding initializer.",
    ));
    return undefined;
  }
  const binding = planForInBinding(initializer, fact.elementCarrier, context);
  if (binding === undefined) {
    return undefined;
  }
  const expressionNode = Node_Expression(ast, node);
  const expression = expressionNode === undefined ? undefined : planExpression(expressionNode, context);
  const bodyNode = ForInOrOfStatement_Statement(ast, node);
  if (expression === undefined || bodyNode === undefined || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.for-in-shape",
      "for-in requires exact receiver, body, and hygienic-name evidence.",
    ));
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const body = planBlockLike(bodyNode, withRustControlTarget(context, target));
  if (body === undefined) {
    return undefined;
  }
  if (fact.lowering.kind === "dense-index-keys") {
    const lengthName = allocateRustSyntheticName(context.syntheticNames, "for_in_length");
    const indexName = allocateRustSyntheticName(context.syntheticNames, "for_in_index");
    const nativeKey: RustExpr = {
      kind: "method-call",
      receiver: { kind: "path", path: indexName },
      method: "to_string",
      args: [],
    };
    const activation = activateForInBinding(
      binding,
      isRustJsStringCarrier(fact.elementCarrier)
        ? { kind: "call", path: "js_abi::JsString::from", args: [nativeKey] }
        : nativeKey,
    );
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
    ? activateForInBinding(binding, { kind: "path", path: keyName })
    : [];
  const iterable: RustExpr = fact.lowering.kind === "js-array-index-keys"
    ? {
        kind: "method-call",
        receiver: expression,
        method: "enumerable_own_keys",
        args: [],
      }
    : {
        kind: "slice-literal",
        elements: fact.lowering.keys.map((key) =>
          isRustJsStringCarrier(fact.elementCarrier)
            ? planRustJsStringLiteral(key, context)
            : { kind: "string-literal", value: key }),
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

function planForInBinding(
  initializer: Node,
  elementCarrier: TargetTypeRef,
  context: RustPlanContext,
): PlannedForInBinding | undefined {
  const declarations = collectVariableDeclarations(initializer, context);
  if (declarations.length === 1) {
    const declaration = declarations[0]!;
    const directName = context.input.program.names.nameForDeclaration(declaration) ?? "";
    const carrier = context.input.program.facts.getRuntimeCarrierFact(declaration)?.carrier;
    const declarationKind = context.input.program.source.ast.variableDeclarationKind(declaration);
    if (!isValidRustIdentifier(directName) || carrier === undefined ||
      !rustTargetTypeRefEquals(carrier, elementCarrier) ||
      declarationKind === "using" || declarationKind === "await using") {
      return rejectForInBinding(declaration, context, "for-in declarations require one plain non-resource binding with the finalized String key carrier.");
    }
    return {
      kind: "declaration",
      name: directName,
      mutable: context.input.program.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined,
    };
  }
  if (context.input.program.source.ast.kindName(initializer) !== KindIdentifier) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one exact identifier location.");
  }
  const assignmentDeclaration = context.input.program.facts.getFact(
    initializer,
    rustSourceBindingFactKey,
  )?.sourceDeclaration;
  if (assignmentDeclaration === undefined) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one exact source declaration.");
  }
  const assignmentName = context.input.program.names.nameForDeclaration(assignmentDeclaration) ?? "";
  if (!isValidRustIdentifier(assignmentName)) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one planned Rust binding name.");
  }
  const carrier = context.input.program.facts.getRuntimeCarrierFact(assignmentDeclaration)?.carrier;
  if (carrier === undefined || !rustTargetTypeRefEquals(carrier, elementCarrier)) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one declaration carrier matching the finalized String key carrier.");
  }
  if (context.input.program.facts.getFact(assignmentDeclaration, rustMutatedBindingFactKey) === undefined) {
    return rejectForInBinding(initializer, context, "for-in assignment targets require one finalized mutable-binding fact.");
  }
  return { kind: "assignment", name: assignmentName };
}

function activateForInBinding(
  binding: PlannedForInBinding,
  value: RustExpr,
): readonly RustStmt[] {
  if (binding.kind === "declaration") {
    return [{ kind: "let", name: binding.name, mutable: binding.mutable, init: value }];
  }
  return [{
    kind: "assign",
    target: { kind: "path", path: binding.name },
    operator: "=",
    value,
  }];
}

function rejectForInBinding(
  node: Node,
  context: RustPlanContext,
  message: string,
): undefined {
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.for-in-binding",
    message,
  ));
  return undefined;
}
