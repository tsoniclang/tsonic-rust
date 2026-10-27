import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";
import type { rustCallableProtocol, rustClosureProtocol } from "../../types/index.js";
import type { RustCallableJoinWrite } from "../native/native-storage.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";

export interface RustLambdaParameterEmission {
  readonly declaration: Node;
  readonly pattern: Node | undefined;
  readonly carrier: TargetTypeRef;
  readonly valueCarrier: TargetTypeRef;
  readonly form: "required" | "optional" | "default" | "rest";
  readonly byRefCopy: boolean;
  readonly mutable: boolean;
}

export interface RustNativeLambdaEmission {
  readonly construction: "native";
  readonly constructionCarrier: TargetTypeRef;
  readonly protocol: ReturnType<typeof rustCallableProtocol>;
  readonly nativeClosure: ReturnType<typeof rustClosureProtocol>;
  readonly borrowedInput: boolean;
  readonly parameters: readonly RustLambdaParameterEmission[];
  readonly resultCarrier: TargetTypeRef;
  readonly bodyCarrier: TargetTypeRef;
  readonly unitBody: boolean;
  readonly physicalCarrier: TargetTypeRef | undefined;
  readonly invocationError: TargetTypeRef | undefined;
  readonly bodyErrorConversion: RustValueConversionContract | undefined;
  readonly resultFallible: boolean;
  readonly bodyFallible: boolean;
  readonly staticStorage: boolean;
  readonly mutableCapture: boolean;
  // An independent frame family member whose error is uninhabited is written into the family's callable error.
  readonly independentWrite: RustCallableJoinWrite | undefined;
}

export type RustLambdaEmission = RustNativeLambdaEmission | {
  readonly construction: "frame";
  readonly constructionCarrier: TargetTypeRef;
} | {
  readonly construction: "generic";
  readonly constructionCarrier: TargetTypeRef;
};

export interface RustLambdaEmissionRecords {
  readonly lambdaBody: RustRecordFamily<RustLambdaEmission>;
}
