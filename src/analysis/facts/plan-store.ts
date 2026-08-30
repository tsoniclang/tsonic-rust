import type {
  ExtensionFactKey,
  ExtensionFactSubject,
  ReadonlySourceFactResolver,
} from "@tsonic/tsts";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import {
  isRustPlanKey,
  rustArgumentPassingKey,
  rustConversionKey,
  rustRuntimeCarrierKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "./operations/keys.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import {
  rustFoundationForCarrier,
  rustFoundationForSelectedCall,
  rustFoundationForSelectedOperation,
} from "../foundation/requirements.js";
import { rustFoundationForTargetOperationFact } from "../foundation/operation-requirements.js";
import type {
  RustIterationSelection,
  RustPlanQueries,
  RustPlanWriter,
} from "../../target-model/facts/selections.js";

export interface RustPlanBuilder extends RustPlanWriter {
  seal(): RustPlanQueries;
  minimumFoundation(): RustFoundation;
}

export function createRustPlanBuilder(
  sourceFacts: ReadonlySourceFactResolver,
): RustPlanBuilder {
  const values = new Map<RustPlanKey<unknown>, WeakMap<object, unknown>>();
  let sealed = false;
  let minimumFoundation: RustFoundation = "core";

  const get = <T>(
    subject: ExtensionFactSubject | undefined,
    key: RustPlanKey<T> | ExtensionFactKey<T>,
  ): T | undefined => {
    if (subject === undefined) return undefined;
    return isRustPlanKey(key)
      ? values.get(key as RustPlanKey<unknown>)?.get(subject) as T | undefined
      : sourceFacts.getFact(subject, key);
  };

  const queries: RustPlanQueries = Object.freeze({
    get,
    resolve: get,
    getFact: get,
    getRuntimeCarrierFact: (subject: ExtensionFactSubject | undefined) => get(subject, rustRuntimeCarrierKey),
    getSelectedTargetCall: (subject: ExtensionFactSubject | undefined) => get(subject, rustSelectedCallKey),
    getSelectedTargetOperation: (subject: ExtensionFactSubject | undefined) => get(subject, rustSelectedOperationKey),
    getSelectedTargetProperty: (subject: ExtensionFactSubject | undefined) => get(subject, rustSelectedOperationKey),
    getSelectedTargetElementAccess: (subject: ExtensionFactSubject | undefined) => get(subject, rustSelectedOperationKey),
    getSelectedTargetOperator: (subject: ExtensionFactSubject | undefined) => get(subject, rustSelectedOperationKey),
    getSelectedTargetIteration(subject: ExtensionFactSubject | undefined) {
      const operation = get(subject, rustSelectedOperationKey);
      return operation?.operationKind === "iteration" && operation.resultType !== undefined
        ? operation as RustIterationSelection
        : undefined;
    },
    getTargetConversionFact: (subject: ExtensionFactSubject | undefined) => get(subject, rustConversionKey),
    getArgumentPassingFact: (subject: ExtensionFactSubject | undefined) => get(subject, rustArgumentPassingKey),
  });

  return Object.freeze({
    ...queries,
    set<T>(subject: ExtensionFactSubject, key: RustPlanKey<T>, value: T): void {
      if (sealed) {
        throw new Error("Rust semantic plans cannot be written after analysis is sealed.");
      }
      let bySubject = values.get(key as RustPlanKey<unknown>);
      if (bySubject === undefined) {
        bySubject = new WeakMap<object, unknown>();
        values.set(key as RustPlanKey<unknown>, bySubject);
      }
      const existing = bySubject.get(subject);
      if (existing !== undefined && !key.equals(existing as T, value)) {
        throw new Error(
          `Conflicting Rust semantic plan '${key.id}' for one exact source subject.`,
        );
      }
      if (existing === undefined) bySubject.set(subject, value);
      if (key === rustRuntimeCarrierKey) {
        minimumFoundation = maximumRustFoundation(
          minimumFoundation,
          rustFoundationForCarrier((value as { readonly carrier: import("../../target-model/types/model.js").RustTargetTypeRef }).carrier),
        );
      } else if (key === rustSelectedCallKey) {
        minimumFoundation = maximumRustFoundation(
          minimumFoundation,
          rustFoundationForSelectedCall(value as import("../../target-model/types/model.js").RustSelectedTargetSignature),
        );
      } else if (key === rustSelectedOperationKey) {
        minimumFoundation = maximumRustFoundation(
          minimumFoundation,
          rustFoundationForSelectedOperation(value as import("../../target-model/types/model.js").RustSelectedTargetOperation),
        );
      } else if (key === rustConversionKey) {
        const convertedType = (value as { readonly convertedType?: import("../../target-model/types/model.js").RustTargetTypeRef }).convertedType;
        if (convertedType !== undefined) {
          minimumFoundation = maximumRustFoundation(
            minimumFoundation,
            rustFoundationForCarrier(convertedType),
          );
        }
      } else if (key === rustTargetOperationFactKey) {
        minimumFoundation = maximumRustFoundation(
          minimumFoundation,
          rustFoundationForTargetOperationFact(
            value as import("./operations/facts.js").RustTargetOperationFact,
          ),
        );
      }
    },
    minimumFoundation(): RustFoundation {
      return minimumFoundation;
    },
    seal(): RustPlanQueries {
      if (sealed) {
        throw new Error("Rust semantic plans can be sealed only once.");
      }
      sealed = true;
      return queries;
    },
  });
}
