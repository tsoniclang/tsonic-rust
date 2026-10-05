import type { Node } from "@tsonic/tsts";
import type { RustProjectConstructionPlan } from "../../../../analysis/project-types/construction-plan.js";
import { substituteRustTargetGenerics } from "../../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustExpr, RustStmt, RustType } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planRustReceiverAlias } from "../../objects/polymorphism/receiver-aliases.js";
import { diagnosticInput, type RustPlanContext, type RustConstructionPreparation } from "../../program/plan-context.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { createRustCapturedField, createRustDeferredFieldOwner, initializeRustCapturedField,
  rustCapturedFieldLocation, rustCapturedFieldStorage, initializeOrWriteRustCapturedField } from "../../objects/captured-fields.js";

export interface RustConstructionStorageField {
  readonly declaration: Node;
  readonly storageIndex: number;
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly storageType: RustType;
}

export interface RustConstructionBody {
  readonly declarations: readonly RustStmt[];
  readonly values: ReadonlyMap<Node, RustExpr>;
  readonly root: RustExpr;
  initialize(declaration: Node, value: RustExpr): readonly RustStmt[] | undefined;
  exportInitialized(declarations: readonly Node[], statements: readonly RustStmt[]): readonly RustStmt[];
  prepare(node: Node, context: RustPlanContext): RustConstructionPreparation | undefined;
  contextForLayer(context: RustPlanContext, returnLabel?: { readonly id: number; readonly label: string }): RustPlanContext;
  finish(): readonly RustStmt[];
}

export function planRustConstructionBody(
  plan: RustProjectConstructionPlan,
  fields: readonly RustConstructionStorageField[],
  carrier: TargetTypeRef,
  type: RustType,
  materialize: (values: ReadonlyMap<Node, RustExpr>) => RustExpr,
  context: RustPlanContext,
): RustConstructionBody | undefined {
  for (const issue of plan.issues) context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, issue.node), "rust.backend.constructor-readiness", issue.reason));
  if (plan.issues.length !== 0 || context.syntheticNames === undefined) return undefined;
  if (fields.length !== plan.fields.length || new Set(fields.map(field => field.declaration)).size !== fields.length ||
    fields.some(field => !plan.fields.some(planned =>
    planned.declaration === field.declaration))) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, plan.definition.declaration),
      "rust.backend.constructor-storage", "Native constructor storage differs from its sealed physical field plan."));
    return undefined;
  }
  const slots: (RustConstructionStorageField & { readonly expression: Extract<RustExpr, { readonly kind: "path" }> })[] = [];
  const declarations: RustStmt[] = [];
  const values = new Map<Node, RustExpr>();
  const declarationAtInitialization = new Set<Node>();
  for (const field of fields) {
    const name = allocateRustSyntheticName(context.syntheticNames, `field_${field.targetName}`);
    const expression: Extract<RustExpr, { readonly kind: "path" }> = { kind: "path", path: name };
    const planned = plan.fields.find(planned => planned.declaration === field.declaration);
    const absence = planned?.absenceDefault === true;
    const storage = rustCapturedFieldStorage(field.declaration, context);
    if (storage?.initialization !== "deferred" && !plan.layerHasEarlyReturn(planned!.owner) &&
      (planned?.initializer !== undefined || planned?.externallyInitialized === true))
      declarationAtInitialization.add(field.declaration);
    else declarations.push({ kind: "let", name, mutable: storage === undefined, type: field.storageType,
      ...(absence ? { init: createRustCapturedField(storage, planRustAbsentValue(field.carrier, context)) }
        : storage?.initialization === "deferred" ? { init: createRustDeferredFieldOwner() } : {}) });
    slots.push({ ...field, expression });
    values.set(field.declaration, expression);
  }
  const rootName = allocateRustSyntheticName(context.syntheticNames, "constructed");
  const root: RustExpr = { kind: "path", path: rootName };
  if (plan.publishesReceiver) declarations.push({ kind: "let", name: rootName, mutable: true, type });
  const publication = (): readonly RustStmt[] => [{ kind: "assign", target: root, operator: "=", value: materialize(values) }];
  const overrideNodes = new Set(plan.expressions.flatMap(expression => expression.receiver === undefined
    ? [expression.node] : [expression.node, expression.receiver]));
  const prepare: RustConstructionBody["prepare"] = (node, selectedContext) => {
    const point = plan.pointFor(node);
    if (point === undefined) return undefined;
    const reject = (reason: string): undefined => {
      selectedContext.diagnostics.push(missingFactDiagnostic(diagnosticInput(selectedContext, node),
        "rust.backend.constructor-readiness-projection", reason));
      return undefined;
    };
    const overrides = new Map(selectedContext.expressionOverrides ?? []);
    const locations = new Map(selectedContext.valueFieldLocations ?? []);
    const capturedFieldOwners = new Map(selectedContext.capturedFieldOwners ?? []);
    for (const overridden of overrideNodes) overrides.delete(overridden);
    for (const expression of plan.expressionsWithin(node)) {
      if ((expression.kind === "field" || expression.kind === "capture") && !point.published) {
        const slot = slots.find(field => field.declaration === expression.declaration);
        if (slot === undefined) return reject("Sealed construction field has no matching physical local slot.");
        const storage = rustCapturedFieldStorage(slot.declaration, selectedContext);
        if (storage === undefined) {
          if (expression.kind === "capture") return reject("A captured native field lost its exact physical owner contract.");
          overrides.set(expression.node, { expression: slot.expression, carrier: slot.carrier, valueForm: "storage" });
        } else {
          const selectedPoint = plan.pointFor(expression.node) ?? point;
          const initialized = selectedPoint.initializedFields.includes(slot.declaration);
          const possiblyInitialized = selectedPoint.possiblyInitializedFields.includes(slot.declaration);
          capturedFieldOwners.set(expression.node, slot.expression);
          const location = rustCapturedFieldLocation(storage, slot.expression, slot.carrier);
          locations.set(expression.node, initialized ? location : { ...location,
            write: value => possiblyInitialized ? initializeOrWriteRustCapturedField(storage, slot.expression, value)
              : initializeRustCapturedField(storage, slot.expression, value),
          });
        }
      } else if (point.published) {
        const receiverNode = expression.kind === "receiver" ? expression.node : expression.receiver;
        if (receiverNode === undefined) return reject("Sealed construction projection has no exact receiver node.");
        const selected = selectedContext.input.program.facts.getRuntimeCarrierFact(receiverNode)?.carrier;
        if (selected === undefined) return reject("Sealed construction receiver has no finalized native carrier.");
        const substituted = substituteRustTargetGenerics(selected, selectedContext.typeParameterSubstitutions ?? new Map(),
          selectedContext.lifetimeSubstitutions ?? new Map());
        const receiver = planRustReceiverAlias(root, carrier, substituted, selectedContext);
        if (receiver === undefined) return reject("Finalized construction receiver differs from its same-root native view.");
        overrides.set(receiverNode, { expression: receiver, carrier: substituted, valueForm: "storage" });
      }
    }
    return { context: { ...selectedContext, expressionOverrides: overrides, valueFieldLocations: locations, capturedFieldOwners },
      before: point.publishBefore ? publication() : [],
      finish(statements) {
        const planned = point.publishMissingElse ? statements.map(statement => statement.kind === "if"
          ? { ...statement, else: { statements: publication() } } : statement) : statements;
        return point.publishAfter ? [...planned, ...publication()] : planned;
      },
    };
  };
  const rejectUnboundConstructorReturn = (node: Node, returnContext: RustPlanContext): undefined => {
    returnContext.diagnostics.push(missingFactDiagnostic(diagnosticInput(returnContext, node),
      "rust.backend.constructor-completion", "A constructor completion requires its exact native layer boundary."));
    return undefined;
  };
  const contextForLayer: RustConstructionBody["contextForLayer"] = (selectedContext, returnLabel) => ({
    ...selectedContext,
    construction: {
      prepare,
      returnFor(node, returnContext) {
        if (plan.pointFor(node) === undefined || returnContext.input.program.source.ast.kindName(node) !== "KindReturnStatement")
          return undefined;
        if (Node_Expression(returnContext.input.program.source.ast, node) !== undefined) return undefined;
        if (returnLabel === undefined) return rejectUnboundConstructorReturn(node, returnContext);
        if (returnContext.completionBoundary === undefined) return [{ kind: "break", label: returnLabel.label }];
        let boundary = returnContext.completionBoundary;
        while (boundary.parent !== undefined) boundary = boundary.parent;
        const target = { kind: "label" as const, id: returnLabel.id, label: returnLabel.label,
          used: { value: true }, resourceBoundary: selectedContext.completionBoundary };
        boundary.dispatchTargets.set(target.id, target);
        return [{ kind: "completion-exit", completion: "break", loopId: returnLabel.id,
          resultWrapped: returnContext.completionBoundary.fallible }];
      },
    },
  });
  const final = plan.pointFor(plan.definition.declaration);
  const physicalDeclaration = context.input.program.objectRepresentations.receiverCaptures.storageDeclaration;
  for (const layer of plan.layers) for (const field of layer.fields) {
    const value = values.get(physicalDeclaration(field.declaration));
    if (value !== undefined) values.set(field.declaration, value);
  }
  return { declarations, values, root, prepare, contextForLayer,
    initialize(declaration, value) {
      const physical = physicalDeclaration(declaration);
      const slot = slots.find(field => field.declaration === physical);
      if (slot?.expression.kind !== "path") return undefined;
      const storage = rustCapturedFieldStorage(physical, context);
      if (physical !== declaration) {
        const update = storage === undefined ? undefined : rustCapturedFieldLocation(storage, slot.expression, slot.carrier).write(value);
        return update === undefined ? undefined : [{ kind: "expr", expr: update }];
      }
      return declarationAtInitialization.has(physical)
        ? [{ kind: "let", name: slot.expression.path, mutable: storage === undefined,
          type: slot.storageType, init: createRustCapturedField(storage, value) }]
        : storage?.initialization === "deferred" ? [{ kind: "expr", expr: initializeRustCapturedField(storage, slot.expression, value) }]
        : [{ kind: "assign", target: slot.expression, operator: "=", value: createRustCapturedField(storage, value) }];
    },
    exportInitialized(declarations, statements) {
      const exported = slots.filter(slot => declarations.includes(slot.declaration) && declarationAtInitialization.has(slot.declaration));
      if (exported.length === 0) return [{ kind: "scope", body: { statements } }];
      const name = allocateRustSyntheticName(context.syntheticNames!, "initialized_fields");
      return [{ kind: "let", name, mutable: false, init: { kind: "block", body: { statements: [
        ...statements, { kind: "tail", expr: { kind: "tuple-literal", elements: exported.map(slot => slot.expression) } },
      ] } } }, ...exported.map((slot, index): RustStmt => ({ kind: "let", name: slot.expression.path,
        mutable: rustCapturedFieldStorage(slot.declaration, context) === undefined, type: slot.storageType,
        init: { kind: "field", receiver: { kind: "path", path: name }, name: String(index) },
      }))];
    },
    finish: () => !plan.completesNormally ? []
      : plan.publishesReceiver ? [...(final?.published ? [] : publication()), { kind: "tail", expr: root }]
      : [{ kind: "tail", expr: materialize(values) }],
  };
}
