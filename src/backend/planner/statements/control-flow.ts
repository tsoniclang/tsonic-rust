import {
  DoStatement_Statement,
  LabeledStatement_Label,
  LabeledStatement_Statement,
  IterationStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  BinaryExpression_Left,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindDoStatement,
  KindForStatement,
  KindForInStatement,
  KindIdentifier,
  KindNumericLiteral,
  KindStringLiteral,
  KindWhileStatement,
  KindVariableDeclarationList,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, planResourceManagedBody, resourceFactForPlanning } from "./resources.js";
import { rustBlockDefinitelyExits } from "../../target-ast/normalization/block-flow.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import {
  expressionCarrier,
  negateRustPlannedBooleanExpression,
  planExpression,
  planExpressionBeforeValueProjections,
  planNumericLiteralWithCarrier,
} from "../expressions/index.js";
import { isRustBoolCarrier } from "../../../target-model/types/index.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planExpressionAsStatement } from "./expression-statements.js";
import { planVariableStatement } from "./variable-declarations.js";
import { planRustDeferredCaptureStorage, planRustCaptureStorageRotation } from "../bindings/capture-storage.js";
import { planForInStatement, planForOfStatement } from "./iteration.js";
import {
  rustMutatedBindingFactKey,
  rustOptionProjectionFactKey,
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planSelectedRustProjectTypeTest } from "../expressions/binary.js";
import type { Node } from "@tsonic/tsts";
import type { RustCountedLoopRepresentation } from "../../../analysis/control-flow/counted-loop-representations.js";
import type { RustBlock, RustStmt } from "../../target-ast/nodes.js";
import type { RustControlTarget, RustLoopTarget, RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

function planCondition(condition: Node, context: RustPlanContext, construct: string) {
  const carrier: TargetTypeRef | undefined = expressionCarrier(condition, context);
  if (!isRustBoolCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, condition),
      "rust.backend.condition",
      `${construct} conditions require a finalized bool carrier fact.`,
    ));
    return undefined;
  }
  return planExpression(condition, context);
}

function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock | undefined {
  if (node === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.embedded-statement",
      "Control-flow construct has no source body statement.",
    ));
    return undefined;
  }
  return planBlockLike(node, context);
}

export function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const thenStatement = IfStatement_ThenStatement(context.input.program.source.ast, node);
  const elseStatement = IfStatement_ElseStatement(context.input.program.source.ast, node);
  const selected = tryPlanSelectedProjectTypeTestIf(
    condition,
    thenStatement,
    elseStatement,
    context,
  );
  if (selected.handled) {
    return selected.statements;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(thenStatement, context);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return undefined;
  }
  const terminal = thenBlock.statements.length === 1 ? thenBlock.statements[0] : undefined;
  const ast = context.input.program.source.ast;
  const sourceStatements = thenStatement !== undefined && ast.is.IsBlock(thenStatement)
    ? ast.statements(thenStatement) : [thenStatement];
  const sourceReturn = sourceStatements.length === 1 ? sourceStatements[0] : undefined;
  const returnedExpression = sourceReturn !== undefined && ast.is.IsReturnStatement(sourceReturn)
    ? Node_Expression(ast, sourceReturn) : undefined;
  const returnedOption = context.input.program.facts.getFact(returnedExpression, rustOptionProjectionFactKey);
  if (context.fallibleBoundary === undefined && context.generator === undefined &&
    elseBlock === undefined && planned.kind === "option-presence" && !planned.present &&
    terminal?.kind === "return" && terminal.expr?.kind === "associated-value" &&
    returnedOption?.kind === "none") {
    return [{ kind: "expr", expr: { kind: "option-try", expr: {
      kind: "method-call", receiver: planned.receiver, method: "as_ref", args: [],
    } } }];
  }
  return [{
    kind: "if",
    condition: planned,
    then: thenBlock,
    ...(elseBlock === undefined
      ? {}
      : {
          else: elseBlock,
          ...(context.input.program.source.ast.is.IsIfStatement(elseStatement) ? { elseIf: true as const } : {}),
        }),
  }];
}

function tryPlanSelectedProjectTypeTestIf(
  condition: Node,
  thenStatement: Node | undefined,
  elseStatement: Node | undefined,
  context: RustPlanContext,
): { readonly handled: boolean; readonly statements?: readonly RustStmt[] } {
  const { ast } = context.input.program.source;
  const fact = context.input.program.facts.getFact(condition, rustTargetOperationFactKey);
  const leftNode = fact?.kind === "project-type-test" && fact.lowering.kind === "dispatch"
    ? BinaryExpression_Left(ast, condition)
    : undefined;
  const binding = leftNode === undefined || ast.kindName(leftNode) !== KindIdentifier ||
      context.expressionOverrides?.has(leftNode) === true
    ? undefined
    : context.input.program.facts.getFact(leftNode, rustSourceBindingFactKey);
  if (fact?.kind !== "project-type-test" || fact.lowering.kind !== "dispatch" ||
    leftNode === undefined || binding === undefined || thenStatement === undefined ||
    context.syntheticNames === undefined ||
    context.input.program.facts.getFact(
      binding.sourceDeclaration,
      rustMutatedBindingFactKey,
    ) !== undefined ||
    !rustTargetTypeRefEquals(fact.sourceCarrier, fact.dispatchCarrier)) {
    return { handled: false };
  }
  const narrowedReads = context.input.program.projectFlowReadSelections.readsWithin({
    root: thenStatement,
    declaration: binding.sourceDeclaration,
    sourceCarrier: fact.sourceCarrier,
    dispatchCarrier: fact.dispatchCarrier,
    selectedCarrier: fact.targetCarrier,
  });
  if (narrowedReads.length === 0) {
    return { handled: false };
  }
  const planned = planSelectedRustProjectTypeTest(condition, context);
  if (planned?.selection === undefined) {
    return { handled: true };
  }
  const dispatchName = allocateRustSyntheticName(context.syntheticNames, "selected_dispatch");
  const selectedName = allocateRustSyntheticName(context.syntheticNames, "selected_value");
  const flowReadOverrides = new Map(context.flowReadOverrides ?? []);
  for (const read of narrowedReads) {
    flowReadOverrides.set(read, {
      sourceCarrier: planned.fact.sourceCarrier,
      selectedCarrier: planned.selection.selectedCarrier,
      expression: {
        kind: "method-call",
        receiver: { kind: "path", path: selectedName },
        method: "clone",
        args: [],
      },
    });
  }
  const thenBlock = planEmbeddedBlock(thenStatement, {
    ...context,
    flowReadOverrides,
  });
  const elseBlock = elseStatement === undefined
    ? undefined
    : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return { handled: true };
  }
  return {
    handled: true,
    statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: dispatchName }] }, expression: planned.selection.expression, whenTrue: { kind: "block", body: {
        ...thenBlock,
        statements: [{
          kind: "let",
          name: selectedName,
          mutable: false,
          init: planned.selection.selectedValue({ kind: "path", path: dispatchName }),
        }, ...thenBlock.statements],
      } }, ...(elseBlock === undefined ? {} : { whenFalse: { kind: "block", body: elseBlock } }) } }],
  };
}

export function planLabeledStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const labelNode = LabeledStatement_Label(ast, node);
  const bodyNode = LabeledStatement_Statement(ast, node);
  const sourceLabel = labelNode === undefined ? "" : ast.text(labelNode);
  if (bodyNode === undefined || sourceLabel.length === 0) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.labeled-statement-shape",
      "Labeled statements require exact label and body nodes.",
    ));
    return undefined;
  }
  switch (ast.kindName(bodyNode)) {
    case KindWhileStatement:
      return planWhileStatement(bodyNode, context, sourceLabel);
    case KindDoStatement:
      return planDoStatement(bodyNode, context, sourceLabel);
    case KindForStatement:
      return planForStatement(bodyNode, context, sourceLabel);
    case KindForInStatement:
      return planForInStatement(bodyNode, context, sourceLabel);
    case "KindForOfStatement":
      return planForOfStatement(bodyNode, context, sourceLabel);
    default: {
      const target = createRustBreakTarget(context, "label", sourceLabel);
      if (target === undefined) {
        return undefined;
      }
      const body = planEmbeddedBlock(bodyNode, withRustControlTarget(context, target));
      return body === undefined
        ? undefined
        : [{ kind: "scope", ...(target.used.value ? { label: target.label } : {}), body }];
    }
  }
}


export function planWhileStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(
    IterationStatement_Statement(context.input.program.source.ast, node),
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return planned.kind === "bool-literal" && planned.value
    ? [{
        kind: "loop",
        ...(target.used.value ? { label: target.label } : {}),
        body,
        ...(!target.breakUsed.value ? { neverFallsThrough: true } : {}),
      }]
    : [{
        kind: "while",
        ...(target.used.value ? { label: target.label } : {}),
        condition: planned,
        body,
      }];
}

export function planDoStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  const bodyNode = DoStatement_Statement(context.input.program.source.ast, node);
  if (condition === undefined || bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.do-while-shape",
      "do-while requires concrete body and condition nodes.",
    ));
    return undefined;
  }
  const plannedCondition = planCondition(condition, context, "do-while");
  const baseTarget = createRustLoopTarget(context, [], sourceLabel);
  if (plannedCondition === undefined || baseTarget === undefined) {
    return undefined;
  }
  const conditionExit: RustStmt = {
    kind: "if",
    condition: negateRustPlannedBooleanExpression(condition, plannedCondition, context),
    then: { statements: [{ kind: "break" }] },
  };
  const target: RustLoopTarget = {
    ...baseTarget,
    continuePrelude: [conditionExit],
  };
  const body = planEmbeddedBlock(
    bodyNode,
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return [{
    kind: "loop",
    ...(target.used.value ? { label: target.label } : {}),
    body: rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, conditionExit] },
  }];
}

export function planForStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const counted = context.input.program.countedLoops.representationFor(node);
  if (counted !== undefined) {
    return planCountedForStatement(node, counted, context, sourceLabel);
  }
  const initializer = ForStatement_Initializer(context.input.program.source.ast, node);
  const condition = ForStatement_Condition(context.input.program.source.ast, node);
  const incrementor = ForStatement_Incrementor(context.input.program.source.ast, node);
  const planLoop = (loopContext: RustPlanContext): RustBlock | undefined => {
    const conditionExpr = condition === undefined
      ? { kind: "bool-literal" as const, value: true }
      : planCondition(condition, loopContext, "for");
    const incrementStatements = incrementor === undefined
      ? []
      : planIncrementor(incrementor, loopContext);
    const rotation = planRustCaptureStorageRotation(node, loopContext);
    if (conditionExpr === undefined || incrementStatements === undefined || rotation === undefined) {
      return undefined;
    }
    const continuation = [...rotation, ...incrementStatements];
    const target = createRustLoopTarget(loopContext, continuation, sourceLabel);
    if (target === undefined) {
      return undefined;
    }
    const body = planEmbeddedBlock(
      IterationStatement_Statement(loopContext.input.program.source.ast, node),
      withRustControlTarget(loopContext, target),
    );
    if (body === undefined) {
      return undefined;
    }
    const loopBody: RustBlock = rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, ...continuation] };
    return conditionExpr.kind === "bool-literal" && conditionExpr.value
      ? {
          statements: [{
            kind: "loop",
            ...(target.used.value ? { label: target.label } : {}),
            body: loopBody,
            ...(!target.breakUsed.value ? { neverFallsThrough: true } : {}),
          }],
        }
      : {
          statements: [{
            kind: "while",
            ...(target.used.value ? { label: target.label } : {}),
            condition: conditionExpr,
            body: loopBody,
          }],
        };
  };

  if (initializer === undefined) {
    const loop = planLoop(context);
    return loop?.statements;
  }
  const declarationInitializer = context.input.program.source.ast.kindName(initializer) === KindVariableDeclarationList;
  const declarations = declarationInitializer ? collectVariableDeclarations(initializer, context) : [];
  const resourceDeclaration = declarations.length === 1 &&
      (context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "using" ||
        context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "await using")
    ? declarations[0]
    : undefined;
  const deferred = planRustDeferredCaptureStorage(node, context);
  const initialization = declarationInitializer ? planVariableStatement(initializer, context)
    : planExpressionAsStatement(initializer, context);
  const rotation = planRustCaptureStorageRotation(node, context);
  if (deferred === undefined || initialization === undefined || rotation === undefined) {
    return undefined;
  }
  const initStatements = [...deferred, ...initialization, ...rotation];
  if (resourceDeclaration === undefined) {
    const loop = planLoop(context);
    return loop === undefined
      ? undefined
      : [{ kind: "scope", body: { statements: [...initStatements, ...loop.statements] } }];
  }
  const fact = resourceFactForPlanning(resourceDeclaration, context);
  const resourceName = context.input.program.names.nameForDeclaration(resourceDeclaration) ?? "";
  if (fact === undefined || !isValidRustIdentifier(resourceName)) {
    return undefined;
  }
  const scope = planResourceManagedBody(
    resourceDeclaration,
    resourceName,
    fact,
    context,
    planLoop,
  );
  return scope === undefined
    ? undefined
    : [{ kind: "scope", body: { statements: [...initStatements, scope] } }];
}

function planCountedForStatement(
  node: Node,
  counted: RustCountedLoopRepresentation,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const binding = context.input.program.names.nameForDeclaration(counted.counterDeclaration) ?? "";
  const start = counted.kind === "native-counter"
    ? planExpression(counted.start, context)
    : planNumericLiteralWithCarrier(counted.start, counted.rangeCarrier, context);
  const bound = counted.kind === "native-counter"
    ? planExpression(counted.bound, context)
    : planExpressionBeforeValueProjections(counted.bound, context, "value");
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (!isValidRustIdentifier(binding) || start === undefined || bound === undefined ||
    target === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(
    counted.body,
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  if (counted.kind === "native-counter") {
    return [{
      kind: "for",
      ...(target.used.value ? { label: target.label } : {}),
      binding,
      iterable: { kind: "range", start, end: bound },
      body,
    }];
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.counted-loop-range-name",
      "A sealed integer-range number loop requires one finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const rangeBinding = allocateRustSyntheticName(
    context.syntheticNames,
    `${binding}_range`,
  );
  return [{
    kind: "for",
    ...(target.used.value ? { label: target.label } : {}),
    binding: rangeBinding,
    iterable: { kind: "range", start, end: bound },
    body: {
      ...body,
      statements: [{
        kind: "let",
        name: binding,
        mutable: false,
        init: {
          kind: "numeric-cast",
          expression: { kind: "path", path: rangeBinding },
          target: "f64",
        },
      }, ...body.statements],
    },
  }];
}

export function createRustLoopTarget(
  context: RustPlanContext,
  continuePrelude: readonly RustStmt[],
  sourceLabel?: string,
): RustLoopTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.loop-control",
      "Loop lowering requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustLoopTarget = {
    kind: "loop",
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, "loop"),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
    breakUsed: { value: false },
    continuePrelude,
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

export function createRustBreakTarget(
  context: RustPlanContext,
  kind: "switch" | "label",
  sourceLabel?: string,
): RustControlTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.control-target",
      "Labeled control flow requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustControlTarget = {
    kind,
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, kind),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

export function withRustControlTarget(
  context: RustPlanContext,
  target: RustControlTarget,
): RustPlanContext {
  return {
    ...context,
    controlTargets: [...(context.controlTargets ?? []), target],
  };
}

function planIncrementor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  return planExpressionAsStatement(node, context);
}



export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.program.source.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}
