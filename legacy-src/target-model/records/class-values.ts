import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustClosureCaptureFact } from "./operation-selections.js";

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
