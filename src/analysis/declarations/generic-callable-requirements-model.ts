import { type RequirementContractState } from "./generic-requirement-contract.js";

import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import type { AstReader, Node } from "@tsonic/tsts";

import { type RustErrorTypeContext } from "../errors/error-types.js";

import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";

import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";

import type { RustOwnershipFlow } from "../../target-model/records/ownership-flow.js";

import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";

import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";

import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";

import type { RustNativeCallableInputPlan } from "../callables/native-inputs.js";

import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustProjectStructuralView } from "../../target-model/records/project-structural-views.js";

import type { RustAnalyzedErrorRegions } from "../errors/regions.js";

import type { RustNativeStoragePlan } from "../callables/native-storage.js";
import type { RustProjectCallableFieldStorage } from "../callables/project-field-storage.js";

export interface RustCallableRequirementInput {
  readonly ownershipFlow: RustOwnershipFlow;
  readonly borrowFor: (node: Node) => "shared" | "mutable" | undefined;
  readonly isStoredValue: (node: Node) => boolean;
  readonly readsValue: (node: Node) => boolean;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly records: RustAnalysisRecords;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly genericCallables: RustGenericCallablePlan;
  readonly nativeCallables: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly projectFieldStorage: RustProjectCallableFieldStorage;
  readonly frameCallables: RustFrameCallablePlan;
  readonly classValues: RustClassValuePlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly structuralViewsFor: (declaration: Node) => readonly RustProjectStructuralView[];
  readonly idByDeclaration: WeakMap<Node, string>;
  readonly bodyIdByDeclaration: WeakMap<Node, string>;
  readonly promiseObjectFacet?: true;
  readonly nativePromiseBody: boolean;
  readonly inheritedBody?: RequirementContractState;
  readonly implementationDeclaration: (declaration: Node) => Node;
  readonly contractFor: (declaration: Node, body?: true) => RequirementContractState | undefined;
  readonly errorRegions: RustAnalyzedErrorRegions;
  readonly errorTypes: RustErrorTypeContext;
}
