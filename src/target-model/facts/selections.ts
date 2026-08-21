import type {
  ArgumentPassingFact,
  ExtensionFactKey,
  ExtensionFactSubject,
} from "@tsonic/tsts";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetTypeRef,
} from "../types/model.js";
import { defineRustPlanKey } from "./keys.js";
import type { RustPlanKey } from "./keys.js";
import {
  rustSelectedTargetOperationEquals,
  rustSelectedTargetSignatureEquals,
  rustTargetTypeRefEquals,
} from "../../target-model/types/equality.js";

export interface RustRuntimeCarrierSelection {
  readonly carrier: RustTargetTypeRef;
}

export interface RustConversionSelection {
  readonly convertedType?: RustTargetTypeRef;
}

export interface RustIterationSelection extends RustSelectedTargetOperation {
  readonly resultType: RustTargetTypeRef;
}

export const rustRuntimeCarrierKey = defineRustPlanKey<RustRuntimeCarrierSelection>(
  "runtimeCarrier",
  (left, right) => rustTargetTypeRefEquals(left.carrier, right.carrier),
);

export const rustSelectedCallKey = defineRustPlanKey<RustSelectedTargetSignature>(
  "selectedCall",
  rustSelectedTargetSignatureEquals,
);

export const rustSelectedOperationKey = defineRustPlanKey<RustSelectedTargetOperation>(
  "selectedOperation",
  rustSelectedTargetOperationEquals,
);

export const rustConversionKey = defineRustPlanKey<RustConversionSelection>(
  "conversion",
  (left, right) => rustTargetTypeRefEquals(left.convertedType, right.convertedType),
);

export const rustArgumentPassingKey = defineRustPlanKey<ArgumentPassingFact>(
  "argumentPassing",
  (left, right) => left.mode === right.mode &&
    left.storageExpression === right.storageExpression,
);

export interface RustPlanQueries {
  get<T>(
    subject: ExtensionFactSubject | undefined,
    key: RustPlanKey<T> | ExtensionFactKey<T>,
  ): T | undefined;

  resolve<T>(
    subject: ExtensionFactSubject | undefined,
    key: RustPlanKey<T> | ExtensionFactKey<T>,
  ): T | undefined;

  getFact<T>(subject: ExtensionFactSubject | undefined, key: RustPlanKey<T>): T | undefined;

  getRuntimeCarrierFact(subject: ExtensionFactSubject | undefined): RustRuntimeCarrierSelection | undefined;

  getSelectedTargetCall(subject: ExtensionFactSubject | undefined): RustSelectedTargetSignature | undefined;

  getSelectedTargetOperation(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined;

  getSelectedTargetProperty(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined;

  getSelectedTargetElementAccess(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined;

  getSelectedTargetOperator(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined;

  getSelectedTargetIteration(subject: ExtensionFactSubject | undefined): RustIterationSelection | undefined;

  getTargetConversionFact(subject: ExtensionFactSubject | undefined): RustConversionSelection | undefined;

  getArgumentPassingFact(subject: ExtensionFactSubject | undefined): ArgumentPassingFact | undefined;
}

export interface RustPlanWriter extends RustPlanQueries {
  set<T>(
    subject: ExtensionFactSubject,
    key: RustPlanKey<T>,
    value: T,
    evidence?: readonly unknown[],
  ): void;
}

export function isRustPlanKey<T>(
  key: RustPlanKey<T> | ExtensionFactKey<T>,
): key is RustPlanKey<T> {
  return typeof (key as { readonly id?: unknown }).id === "string" &&
    (key as { readonly id: string }).id.startsWith("tsonic.rust.");
}
