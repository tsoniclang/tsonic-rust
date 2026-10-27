import type { Node } from "@tsonic/tsts";
import { ForStatement_Incrementor, ForStatement_Initializer, IterationStatement_Statement,
  KindVariableDeclarationList } from "@tsonic/target-api/source";
import type { RustBlock, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustCountedLoopRepresentation } from "../../../target-model/records/operations/counted-loops.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planResourceDeclarations } from "./resource-management.js";
import { planExpression, planExpressionBeforeValueProjections, planNumericLiteralWithCarrier } from "../expressions/index.js";
import { planRustDeferredCaptureStorage, planRustCaptureStorageRotation } from "../bindings/capture-storage.js";
import { planExpressionAsStatement } from "./statement-simple.js";
import { planVariableStatement } from "../bindings/locals.js";
import { createRustLoopTarget, withRustControlTarget } from "./loop-regions.js";
import { planCondition, planEmbeddedBlock } from "./statement-conditionals.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planForStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const counted = context.input.program.records.countedLoop.get(node);
  if (counted !== undefined) return planCountedForStatement(node, counted, context);
  const initializer = ForStatement_Initializer(context.input.program.source.ast, node);
  const condition = context.input.program.records.statementCondition.get(node);
  const incrementor = ForStatement_Incrementor(context.input.program.source.ast, node);
  const form = context.input.program.records.loopForm.get(node);
  if (form === undefined) failRustPlannerInvariant("An admitted for statement requires its sealed native loop form.", node);
  const planLoop = (loopContext: RustPlanContext): RustBlock => {
    const conditionExpr = condition === undefined ? { kind: "bool-literal" as const, value: true } : planCondition(node, loopContext);
    const incrementStatements = incrementor === undefined ? [] : planExpressionAsStatement(incrementor, loopContext);
    const rotation = planRustCaptureStorageRotation(node, loopContext);
    if (incrementStatements === undefined || rotation === undefined)
      failRustPlannerInvariant("An admitted for statement requires its native continuation plan.", node);
    const continuation = [...rotation, ...incrementStatements];
    const target = createRustLoopTarget(loopContext, node, continuation);
    const bodyNode = IterationStatement_Statement(loopContext.input.program.source.ast, node);
    const body = planEmbeddedBlock(bodyNode, withRustControlTarget(loopContext, target));
    const bodyExits = loopContext.input.program.records.statementExit.get(bodyNode);
    if (bodyExits === undefined) failRustPlannerInvariant("An admitted for body requires its sealed completion.", node);
    const loopBody: RustBlock = bodyExits ? body : { statements: [...body.statements, ...continuation] };
    return { statements: [form.kind === "unconditional" ? {
      kind: "loop", ...(target.used.value ? { label: target.label } : {}), body: loopBody,
      ...(form.neverFallsThrough ? { neverFallsThrough: true } : {}),
    } : { kind: "while", ...(target.used.value ? { label: target.label } : {}), condition: conditionExpr, body: loopBody }] };
  };
  if (initializer === undefined) return planLoop(context).statements;
  const declarationInitializer = context.input.program.source.ast.kindName(initializer) === KindVariableDeclarationList;
  const resourceDeclarations = context.input.program.records.resourceScope.get(node)?.declarations ?? [];
  const deferred = planRustDeferredCaptureStorage(node, context);
  if (deferred === undefined) failRustPlannerInvariant("An admitted for statement requires its deferred capture prologue.", node);
  if (resourceDeclarations.length > 0) {
    const scoped = planResourceDeclarations(resourceDeclarations, context, bodyContext => {
      const rotation = planRustCaptureStorageRotation(node, bodyContext);
      if (rotation === undefined) failRustPlannerInvariant("An admitted resource for statement requires its capture rotation.", node);
      return { statements: [...rotation, ...planLoop(bodyContext).statements] };
    });
    if (scoped === undefined) failRustPlannerInvariant("An admitted resource for statement requires its native resource plan.", node);
    return [{ kind: "scope", body: { statements: [...deferred, ...scoped] } }];
  }
  const initialization = declarationInitializer ? planVariableStatement(initializer, context) : planExpressionAsStatement(initializer, context);
  const rotation = planRustCaptureStorageRotation(node, context);
  if (initialization === undefined || rotation === undefined)
    failRustPlannerInvariant("An admitted for statement requires its native initialization and capture rotation.", node);
  return [{ kind: "scope", body: { statements: [...deferred, ...initialization, ...rotation, ...planLoop(context).statements] } }];
}

function planCountedForStatement(
  node: Node, counted: RustCountedLoopRepresentation, context: RustPlanContext,
): readonly RustStmt[] {
  const binding = context.input.program.records.sourceName.get(counted.counterDeclaration);
  const liveness = context.input.program.records.bindingLiveness.get(counted.counterDeclaration);
  const start = counted.kind === "native-counter" ? planExpression(counted.start, context)
    : planNumericLiteralWithCarrier(counted.start, counted.rangeCarrier, context);
  const bound = counted.kind === "native-counter" ? planExpression(counted.bound, context)
    : planExpressionBeforeValueProjections(counted.bound, context, "value");
  if (binding === undefined || liveness === undefined || start === undefined || bound === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted counted for statement requires its sealed binding, bounds and name scope.", node);
  const target = createRustLoopTarget(context, node, []);
  const body = planEmbeddedBlock(counted.body, withRustControlTarget(context, target));
  if (counted.kind === "native-counter") return [{ kind: "for", ...(target.used.value ? { label: target.label } : {}),
    binding: liveness.unused ? "_" : binding, iterable: { kind: "range", start, end: bound }, body }];
  if (liveness.unused) return [{ kind: "for", ...(target.used.value ? { label: target.label } : {}), binding: "_",
    iterable: { kind: "range", start, end: bound }, body }];
  const rangeBinding = allocateRustSyntheticName(context.syntheticNames, `${binding}_range`);
  return [{ kind: "for", ...(target.used.value ? { label: target.label } : {}), binding: rangeBinding,
    iterable: { kind: "range", start, end: bound }, body: { ...body, statements: [{
      kind: "let", name: binding, mutable: false,
      init: { kind: "numeric-cast", expression: { kind: "path", path: rangeBinding }, target: "f64" },
    }, ...body.statements] } }];
}
