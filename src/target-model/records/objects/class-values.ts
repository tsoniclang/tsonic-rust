import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";

export interface RustClassValueFact {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly carrier: TargetTypeRef;
}

export interface RustClassEnvironment {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly storage: "value" | "shared";
  readonly copy: boolean;
  readonly constructorValue: boolean;
  readonly constructorIdentity: boolean;
  readonly evaluatedConstructorValue: boolean;
  readonly genericParameterIndexes: readonly number[];
  readonly consumers: readonly Node[];
  readonly initializationUsesEnvironment: boolean;
  readonly instancesUseEnvironment: boolean;
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & {
    readonly fieldName: string;
  })[];
  readonly staticFields: readonly {
    readonly declaration: Node;
    readonly fieldName: string;
    readonly carrier: TargetTypeRef;
    readonly readonly: boolean;
  }[];
}

export interface RustNamedClassEnvironment extends RustClassEnvironment {
  readonly typeName: string;
  readonly instanceFieldName: string;
  readonly bindingName: string;
  readonly parameterName: string;
  readonly identityFieldName: string;
}

import type { RustProjectStaticFieldStorage } from "./project-fields.js";
import type { RustClassValueCallable } from "../callables/class-value-callables.js";
import type { RustProjectStructuralView, RustProjectStructuralViewImplementation } from "./project-structural-views.js";

export interface RustClassValueView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly (RustProjectStaticFieldStorage & {
    readonly storageIndex: number;
    readonly writable: boolean;
    readonly callable?: RustClassValueCallable;
  })[];
  readonly construction?: RustClassValueCallable;
}

export interface RustClassValueDefinition {
  readonly declaration: Node;
  readonly environment?: RustNamedClassEnvironment;
  readonly views: readonly RustClassValueView[];
}

export interface RustClassValuePlan {
  readonly constructorViewImplementations: readonly (RustClassValueView & { readonly ownerFileName: string })[];
  readonly instanceViews: readonly RustProjectStructuralView[];
  readonly instanceViewImplementations: readonly RustProjectStructuralViewImplementation[];
  forDeclaration(declaration: Node): RustClassValueDefinition | undefined;
  viewFor(declaration: Node, sourceCarrier: TargetTypeRef, carrier: TargetTypeRef): RustClassValueDefinition["views"][number] | undefined;
}
