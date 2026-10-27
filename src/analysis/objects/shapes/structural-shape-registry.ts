import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceObjectShape, RustStructuralFieldImplementation, RustStructuralInstantiation } from "../../../target-model/records/types/source-types.js";
import type { RustSourceUnionDefinition } from "../../../target-model/types/source-union-definitions.js";
import type { RustNativeObjectField } from "../../../target-model/operations/native-memory.js";
import type { RustStructuralMethodExposure, RustStructuralMethodStorageSelection } from "../../../target-model/records/objects/structural-shapes.js";
import { createRustGeneratedUnionPlan, type RustGeneratedUnionPlan } from "./generated-union-plan.js";
import { createRustStructuralShapeConstruction, type RustStructuralShapeLayout, type RustStructuralShapeLayoutPlan,
  type RustStructuralShapePlan, type RustStructuralPhysicalCarrierSelection } from "./structural-shape-plan.js";

export interface RustStructuralShapePlanRegistry extends RustStructuralShapeLayoutPlan {
  initialize(
    shapes: readonly RustSourceObjectShape[],
    implementations: readonly RustStructuralFieldImplementation[],
    componentForFile: (fileName: string) => string,
    nativeFields: readonly RustNativeObjectField[],
    instantiations: readonly RustStructuralInstantiation[],
    methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
    receiverIndependentMethods?: ReadonlySet<string>,
  ): RustStructuralShapeLayoutPlan;
  initializeUnions(unions: readonly RustSourceUnionDefinition[]): void;
  completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef): RustStructuralPhysicalCarrierSelection;
  instantiateSourceCarrier(source: TargetTypeRef, instance: TargetTypeRef): RustStructuralPhysicalCarrierSelection;
  finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeLayout,
    ReadonlyMap<number, RustStructuralMethodStorageSelection>>, errorForFile: (fileName: string) => TargetTypeRef | undefined): void;
  isInitialized(): boolean;
  readonly completed: RustStructuralShapePlan;
  seal(): RustStructuralShapePlan;
}

export function createRustStructuralShapePlanRegistry(): RustStructuralShapePlanRegistry {
  let current: RustStructuralShapeLayoutPlan | undefined;
  let sealed = false;
  let construction: ReturnType<typeof createRustStructuralShapeConstruction> | undefined;
  let unions: RustGeneratedUnionPlan | undefined;
  let componentForFile: ((fileName: string) => string) | undefined;
  const requireCurrent = (): RustStructuralShapeLayoutPlan => {
    if (current === undefined) {
      throw new Error("Rust structural shape plan was read before source analysis initialized it.");
    }
    return current;
  };
  const requireUnions = (): RustGeneratedUnionPlan => {
    if (unions === undefined) throw new Error("Rust generated unions must be finalized after physical value selection.");
    return unions;
  };
  return Object.freeze({
    initialize(
      shapes: readonly RustSourceObjectShape[],
      implementations: readonly RustStructuralFieldImplementation[],
      selectComponent: (fileName: string) => string,
      nativeFields: readonly RustNativeObjectField[],
      instantiations: readonly RustStructuralInstantiation[],
      methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
      receiverIndependentMethods: ReadonlySet<string> = new Set(),
    ) {
      if (sealed || current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      componentForFile = selectComponent;
      construction = createRustStructuralShapeConstruction(shapes, implementations, selectComponent, nativeFields, instantiations, {
        get unionDefinitions() { return requireUnions().unionDefinitions; },
        unionForCarrier: (carrier: TargetTypeRef) => requireUnions().unionForCarrier(carrier),
      }, methodExposures, receiverIndependentMethods);
      current = construction.plan;
      return current;
    },
    initializeUnions(definitions: readonly RustSourceUnionDefinition[]) {
      // A second finalization is refused as such, also after sealing (sealing requires the first one).
      if (unions !== undefined) throw new Error("Rust generated unions can be finalized only once after structural objects.");
      if (sealed) throw new Error("Rust structural unions cannot change after sealing.");
      const shapes = requireCurrent();
      if (componentForFile === undefined)
        throw new Error("Rust generated unions can be finalized only once after structural objects.");
      const names = new Map<string, Set<string>>();
      for (const shape of shapes.definitions) {
        const selected = names.get(shape.componentId) ?? new Set<string>();
        selected.add(shape.targetName);
        if (shape.dispatchName !== undefined) selected.add(shape.dispatchName);
        names.set(shape.componentId, selected);
      }
      unions = createRustGeneratedUnionPlan(definitions, componentForFile, names);
    },
    instantiateSourceCarrier(source: TargetTypeRef, instance: TargetTypeRef) {
      if (sealed || construction === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source instances require their open initialized structural builder.");
      return construction.instantiateSourceCarrier(source, instance);
    },
    completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef) {
      if (sealed || construction === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural physical carriers require their open initialized builder.");
      return construction.completePhysicalCarrier(source, physical);
    },
    finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeLayout,
      ReadonlyMap<number, RustStructuralMethodStorageSelection>>, errorForFile: (fileName: string) => TargetTypeRef | undefined) {
      // A second finalization is refused as such, also after sealing.
      if (construction?.methodStorageFinalized() === true || !sealed && construction !== undefined) {
        construction.finalizeMethodStorage(selections, errorForFile);
        return;
      }
      throw new Error("Structural method storage requires its open initialized shape builder.");
    },
    isInitialized() {
      return current !== undefined;
    },
    get completed() {
      if (construction === undefined) failTargetAnalysisInvariant("tsonic-rust", "Completed structural storage requires its initialized native owner.");
      return construction.completed();
    },
    seal() {
      if (sealed) throw new Error("Rust structural storage seals once.");
      requireUnions();
      if (construction === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural storage seals its initialized native owner.");
      const complete = construction.close();
      sealed = true;
      current = complete;
      return complete;
    },
    get definitions() {
      return requireCurrent().definitions;
    },
    get instances() {
      return requireCurrent().instances;
    },
    get unionDefinitions() {
      return requireCurrent().unionDefinitions;
    },
    unionForCarrier(carrier: TargetTypeRef) {
      return requireCurrent().unionForCarrier(carrier);
    },
    definitionForCarrier(carrier: TargetTypeRef | undefined) {
      return requireCurrent().definitionForCarrier(carrier);
    },
    templateForCarrier(carrier: TargetTypeRef) {
      return requireCurrent().templateForCarrier(carrier);
    },
    sharesStorage(left: TargetTypeRef, right: TargetTypeRef) {
      return requireCurrent().sharesStorage(left, right);
    },
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      return requireCurrent().fieldName(carrier, storageIndex);
    },
    field(carrier: TargetTypeRef, storageIndex: number) {
      return requireCurrent().field(carrier, storageIndex);
    },
  });
}
