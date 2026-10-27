import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import type { Node } from "@tsonic/tsts";
import type { RustAdmittedConstruction, RustConstructionLayer } from "../../../../target-model/records/objects/construction.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustExpr, RustStmt, RustType } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { renderRustReceiverAlias } from "../../objects/polymorphism/receiver-aliases.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { type RustPlanContext, type RustConstructionPreparation } from "../../program/plan-context.js";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { rustConstructionFieldStorage } from "../../objects/construction-field-storage.js";
import { planRustValueFieldInput } from "../../objects/value-fields.js";
import { createRustClassFrameValue, rustClassFrameOwner } from "../../objects/frame-storage.js";
import { rustFrameBindingLocation } from "../../bindings/frame-storage.js";
import { rustFrameCallableTypes } from "../../types/frame-callables.js";
import type { RustLiveFrameOwner } from "../../program/frame-owners.js";

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
  input(declaration: Node, node: Node, context: RustPlanContext, planValue: () => RustExpr | undefined): RustExpr | undefined;
  exportInitialized(layer: RustProjectTypeDefinition, declarations: readonly Node[], statements: readonly RustStmt[]): readonly RustStmt[];
  prepare(node: Node, context: RustPlanContext): RustConstructionPreparation | undefined;
  contextForLayer(context: RustPlanContext, layer: RustConstructionLayer,
    returnLabel?: { readonly id: number; readonly label: string }): RustPlanContext;
  finish(): readonly RustStmt[];
}

export function planRustConstructionBody(
  plan: RustAdmittedConstruction,
  fields: readonly RustConstructionStorageField[],
  type: RustType,
  materialize: (values: ReadonlyMap<Node, RustExpr>, identity?: RustExpr, frameCounter?: RustExpr, retainedFrame?: RustExpr) => RustExpr,
  context: RustPlanContext,
): RustConstructionBody | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted construction requires its hygienic name owner.", plan.definition.declaration);
  const physicalFields = new Map(fields.map(field => [field.declaration, field]));
  const slots: (RustConstructionStorageField & { readonly expression: Extract<RustExpr, { readonly kind: "path" }> })[] = [];
  const declarations: RustStmt[] = [];
  const frame = plan.emission.frame;
  const frameCounter: RustExpr | undefined = frame === undefined ? undefined
    : { kind: "path", path: allocateRustSyntheticName(context.syntheticNames, "frame_counter") };
  if (frameCounter?.kind === "path") {
    context.usedAliases?.add("rt");
    declarations.push({ kind: "let", name: frameCounter.path, mutable: false,
      init: { kind: "call", path: "rt::FrameEntryCounter::new", args: [] } });
  }
  const retainedIdentity = fields.some(field => plan.retainedFieldIdentities.has(field.declaration));
  const identity: RustExpr | undefined = !retainedIdentity ? undefined : { kind: "path",
    path: allocateRustSyntheticName(context.syntheticNames, "object_identity") };
  if (identity?.kind === "path") declarations.push({ kind: "let", name: identity.path, mutable: false,
    init: { kind: "call", path: "rt::ObjectIdentity::new", args: [] } });
  const values = new Map<Node, RustExpr>();
  const declarationAtInitialization = plan.localFieldDeclarations;
  for (const planned of plan.fields) {
    const field = physicalFields.get(planned.declaration);
    if (field === undefined) failRustPlannerInvariant("Construction field syntax requires its canonical admitted physical field.", planned.declaration);
    const name = allocateRustSyntheticName(context.syntheticNames, `field_${field.targetName}`);
    const expression: Extract<RustExpr, { readonly kind: "path" }> = { kind: "path", path: name };
    const absence = planned.absenceDefault;
    const storage = rustConstructionFieldStorage(field.declaration, field.carrier, context, plan);
    if (!declarationAtInitialization.has(field.declaration)) declarations.push({ kind: "let", name, mutable: storage.mutable, type: field.storageType,
      ...(absence ? { init: storage.create(planRustAbsentValue(field.carrier, context)) }
        : storage.deferred ? { init: storage.createDeferred() } : {}) });
    slots.push({ ...field, expression });
    values.set(field.declaration, expression);
  }
  const rootName = allocateRustSyntheticName(context.syntheticNames, "constructed");
  const root: RustExpr = { kind: "path", path: rootName };
  const completion = (value: RustExpr): RustExpr => context.returnResult === undefined ? value : { kind: "call", path: "Ok", args: [value] };
  const exposure = plan.emission.exposure;
  const frameCarrier = exposure?.carrier;
  const frameType = frameCarrier === undefined ? undefined : rustFrameCallableTypes(frameCarrier, context)?.frameType;
  const retainedFrame: RustExpr | undefined = exposure === undefined ? undefined
    : { kind: "path", path: allocateRustSyntheticName(context.syntheticNames, "construction_frame") };
  if (retainedFrame !== undefined && frameType === undefined) failRustPlannerInvariant(
    "Retained construction syntax requires its admitted exact native frame type.", exposure!.expression);
  const retainedOwner: RustLiveFrameOwner | undefined = retainedFrame === undefined ? undefined
    : { kind: "live", expression: retainedFrame, borrowed: false, data: { kind: "direct" } };
  const retainsFrameAt = (node: Node): boolean => plan.emission.preparations.get(node)?.retainsFrame === true;
  const retainedLocation = (declaration: Node, selectedContext: RustPlanContext) => {
    const binding = frame?.bindings.find(binding => binding.declaration === declaration);
    return binding === undefined || retainedOwner === undefined ? undefined
      : rustFrameBindingLocation(binding, retainedOwner, selectedContext);
  };
  if (plan.publishesReceiver) declarations.push({ kind: "let", name: rootName, mutable: plan.mutableReceiver, type });
  const publication = (): readonly RustStmt[] => [{ kind: "assign", target: root, operator: "=", value: materialize(values, identity, frameCounter, retainedFrame) }];
  const overrideNodes = new Set(plan.expressions.flatMap(expression => expression.receiver === undefined
    ? [expression.node] : [expression.node, expression.receiver]));
  const prepare: RustConstructionBody["prepare"] = (node, selectedContext) => {
    const admitted = plan.emission.preparations.get(node);
    if (admitted === undefined) return undefined;
    const point = admitted.point;
    if (frame !== undefined && frameCounter !== undefined) {
      const frameOwners = new Map(selectedContext.frameOwners);
      const owner = retainedOwner !== undefined && retainsFrameAt(node) ? retainedOwner
        : point.published || point.publishBefore ? rustClassFrameOwner(frame, root, selectedContext)
        : { kind: "construction" as const, counter: frameCounter };
      if (owner === undefined) failRustPlannerInvariant("Construction requires its admitted native frame owner syntax.", node);
      frameOwners.set(frame, owner);
      selectedContext = { ...selectedContext, frameOwners };
    }
    const overrides = new Map(selectedContext.expressionOverrides ?? []);
    const locations = new Map(selectedContext.valueFieldLocations ?? []);
    const capturedFieldOwners = new Map(selectedContext.capturedFieldOwners ?? []);
    const capturedFieldIdentities = new Map(selectedContext.capturedFieldIdentities ?? []);
    for (const overridden of overrideNodes) overrides.delete(overridden);
    for (const projection of admitted.projections) {
      const expression = projection.expression;
      if (projection.kind === "fixed-self") continue;
      if (projection.kind === "local") {
        const slot = slots.find(field => field.declaration === projection.declaration);
        if (slot === undefined) failRustPlannerInvariant("Construction requires its admitted physical local slot syntax.", expression.node);
        const storage = rustConstructionFieldStorage(slot.declaration, slot.carrier, selectedContext, plan);
        const location = retainsFrameAt(node) ? retainedLocation(slot.declaration, selectedContext) ?? storage.location(slot.expression)
          : storage.location(slot.expression);
        if (location === undefined) {
          if (projection.storage !== "value") failRustPlannerInvariant("Captured construction storage requires its admitted native owner syntax.", expression.node);
          overrides.set(expression.node, { expression: slot.expression, carrier: slot.carrier, valueForm: "storage", storageForm: "plain" });
        } else {
          const selectedPoint = plan.points.get(expression.node) ?? point;
          const initialized = selectedPoint.initializedFields.includes(slot.declaration);
          const possiblyInitialized = selectedPoint.possiblyInitializedFields.includes(slot.declaration);
          if (storage.retainedFieldOwner) capturedFieldOwners.set(expression.node, slot.expression);
          if (identity !== undefined && plan.retainedReferenceIdentities.has(expression.node))
            capturedFieldIdentities.set(expression.node, identity);
          locations.set(expression.node, initialized ? location : { ...location,
            write: value => possiblyInitialized ? storage.initializeOrWrite(slot.expression, value)
              : storage.initialize(slot.expression, value),
          });
        }
      } else {
        const receiverNode = projection.node;
        const substituted = projection.carrier;
        let receiver: RustExpr = root;
        if (projection.projection === "polymorphic") {
          const receiverType = rustTypeFromCarrierInContext(substituted, selectedContext);
          if (receiverType?.kind !== "named") failRustPlannerInvariant("Construction requires its admitted same-root native view type syntax.", receiverNode);
          receiver = renderRustReceiverAlias(root, receiverType, false);
        }
        overrides.set(receiverNode, { expression: receiver, carrier: substituted, valueForm: "storage", storageForm: "plain" });
      }
    }
    const allocated = exposure?.expression !== node || frame === undefined || frameCounter === undefined || retainedFrame?.kind !== "path"
      ? undefined : createRustClassFrameValue(frame, values, frameCounter, selectedContext);
    if (exposure?.expression === node && retainedFrame !== undefined && allocated === undefined)
      failRustPlannerInvariant("Retained construction syntax requires its admitted exact physical storage fields.", node);
    return { context: { ...selectedContext, expressionOverrides: overrides, valueFieldLocations: locations, capturedFieldOwners, capturedFieldIdentities },
      before: [...(allocated === undefined || retainedFrame?.kind !== "path" || frameType === undefined ? [] : [{ kind: "let" as const,
        name: retainedFrame.path, mutable: false, init: allocated,
        type: { kind: "named" as const, path: "alloc::rc::Rc", genericArguments: [{ kind: "type" as const, type: frameType }] } }]),
        ...(point.publishBefore ? publication() : [])],
      finish(statements) {
        const planned = point.publishMissingElse ? statements.map(statement => statement.kind === "if"
          ? { ...statement, else: { statements: publication() } } : statement) : statements;
        return point.publishAfter ? [...planned, ...publication()] : planned;
      },
    };
  };
  const contextForLayer: RustConstructionBody["contextForLayer"] = (selectedContext, layer, returnLabel) => ({
    ...selectedContext,
    nativeHeaderPlacement: layer,
    nativeHeaderParent: undefined,
    construction: {
      layer,
      prepare,
      returnFor(node, returnContext) {
        if (plan.returns.get(node) === undefined) return undefined;
        if (returnLabel === undefined) failRustPlannerInvariant("A constructor completion requires its admitted exact native layer boundary.", node);
        if (returnContext.completionBoundary === undefined) return [{ kind: "break", label: returnLabel.label }];
        let boundary = returnContext.completionBoundary;
        while (boundary.parent !== undefined) boundary = boundary.parent;
        const target = { kind: "label" as const, id: returnLabel.id, label: returnLabel.label,
          used: { value: true }, sourceTargets: [], resourceBoundary: selectedContext.completionBoundary };
        boundary.dispatchTargets.set(target.id, target);
        return [{ kind: "completion-exit", completion: "break", loopId: returnLabel.id,
          resultWrapped: returnContext.completionBoundary.fallible }];
      },
    },
  });
  const final = plan.points.get(plan.definition.declaration);
  const physicalDeclaration = (declaration: Node): Node => {
    const physical = plan.physicalDeclarations.get(declaration);
    if (physical === undefined) failRustPlannerInvariant("An admitted construction field requires its exact physical declaration.", declaration);
    return physical;
  };
  for (const layer of plan.layers) for (const field of layer.fields) {
    const value = values.get(physicalDeclaration(field.declaration));
    if (value !== undefined) values.set(field.declaration, value);
  }
  return { declarations, values, root, prepare, contextForLayer,
    input(declaration, node, inputContext, planValue) {
      const slot = slots.find(field => field.declaration === physicalDeclaration(declaration));
      if (slot === undefined) return undefined;
      const location = retainsFrameAt(node) ? retainedLocation(slot.declaration, inputContext)
        ?? rustConstructionFieldStorage(slot.declaration, slot.carrier, inputContext, plan).location(slot.expression)
        : rustConstructionFieldStorage(slot.declaration, slot.carrier, inputContext, plan).location(slot.expression);
      return location === undefined ? planValue() : planRustValueFieldInput(location, node, inputContext, planValue);
    },
    initialize(declaration, value) {
      const physical = physicalDeclaration(declaration);
      const slot = slots.find(field => field.declaration === physical);
      if (slot?.expression.kind !== "path") return undefined;
      const storage = rustConstructionFieldStorage(physical, slot.carrier, context, plan);
      const initializer = plan.fields.find(field => field.declaration === declaration)?.initializer;
      const location = initializer !== undefined && retainsFrameAt(initializer) ? retainedLocation(physical, context) : undefined;
      if (location !== undefined) {
        const initialized = physical !== declaration ? location.write(value, context) : location.initialize?.(value, context);
        return initialized === undefined ? undefined : [{ kind: "expr", expr: initialized }];
      }
      if (physical !== declaration) {
        const update = storage.location(slot.expression)?.write(value, context);
        return update === undefined ? undefined : [{ kind: "expr", expr: update }];
      }
      return declarationAtInitialization.has(physical)
        ? [{ kind: "let", name: slot.expression.path, mutable: storage.mutable,
          ...(plan.unobservedInitializers.has(physical) ? { attrs: [rustLintAttributes.unusedAssignments] } : {}),
          type: slot.storageType, init: storage.create(value) }]
        : storage.deferred ? [{ kind: "expr", expr: storage.initialize(slot.expression, value) }]
        : [{ kind: "assign", target: slot.expression, operator: "=", value: storage.create(value) }];
    },
    exportInitialized(layer, declarations, statements) {
      const exported = slots.filter(slot => declarations.includes(slot.declaration) && declarationAtInitialization.has(slot.declaration));
      if (exported.length === 0) return [{ kind: "scope", body: { statements } }];
      const mutable = plan.mutableFieldLocals.get(layer)
        ?? failRustPlannerInvariant("An admitted construction export requires its exact rebound native binding mutability.", layer.declaration);
      const name = allocateRustSyntheticName(context.syntheticNames!, "initialized_fields");
      return [{ kind: "let", name, mutable: false, init: { kind: "block", body: { statements: [
        ...statements, { kind: "tail", expr: { kind: "tuple-literal", elements: exported.map(slot => slot.expression) } },
      ] } } }, ...exported.map((slot, index): RustStmt => ({ kind: "let", name: slot.expression.path,
        mutable: mutable.has(slot.declaration), type: slot.storageType,
        init: { kind: "field", receiver: { kind: "path", path: name }, name: String(index) },
      }))];
    },
    finish: () => !plan.emission.canFallThrough ? []
      : plan.publishesReceiver ? [...(final?.published ? [] : publication()), { kind: "tail", expr: completion(root) }]
      : [{ kind: "tail", expr: completion(materialize(values, identity, frameCounter, retainedFrame)) }],
  };
}
