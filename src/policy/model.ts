import type {
  ArgumentPassingFact,
  ExtensionFactKey,
  ExtensionFactSubject,
  Node,
  ReadonlySourceFactResolver,
} from "@tsonic/tsts";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetTypeRef,
} from "./types.js";
import { defineRustPlanKey } from "./keys.js";
import type { RustPlanKey } from "./keys.js";
import {
  rustSelectedTargetOperationEquals,
  rustSelectedTargetSignatureEquals,
  rustTargetTypeRefEquals,
} from "./equality.js";

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

export class RustSemanticModel {
  readonly #sourceFacts: ReadonlySourceFactResolver;
  readonly #values = new Map<RustPlanKey<unknown>, WeakMap<object, unknown>>();

  constructor(sourceFacts: ReadonlySourceFactResolver) {
    this.#sourceFacts = sourceFacts;
  }

  get<T>(
    subject: ExtensionFactSubject | undefined,
    key: RustPlanKey<T> | ExtensionFactKey<T>,
  ): T | undefined {
    if (subject === undefined) {
      return undefined;
    }
    if (isRustPlanKey(key)) {
      return this.#values.get(key as RustPlanKey<unknown>)?.get(subject) as
        | T
        | undefined;
    }
    return this.#sourceFacts.getFact(subject, key);
  }

  resolve<T>(
    subject: ExtensionFactSubject | undefined,
    key: RustPlanKey<T> | ExtensionFactKey<T>,
  ): T | undefined {
    return this.get(subject, key);
  }

  set<T>(
    subject: ExtensionFactSubject,
    key: RustPlanKey<T>,
    value: T,
    _evidence?: readonly unknown[],
  ): void {
    let values = this.#values.get(key as RustPlanKey<unknown>);
    if (values === undefined) {
      values = new WeakMap<object, unknown>();
      this.#values.set(key as RustPlanKey<unknown>, values);
    }
    const existing = values.get(subject);
    if (existing !== undefined && !key.equals(existing as T, value)) {
      throw new Error(
        `Conflicting Rust semantic plan '${key.id}' for one exact source subject.`,
      );
    }
    if (existing === undefined) {
      values.set(subject, value);
    }
  }

  getFact<T>(subject: ExtensionFactSubject | undefined, key: RustPlanKey<T>): T | undefined {
    return this.get(subject, key);
  }

  getRuntimeCarrierFact(subject: ExtensionFactSubject | undefined): RustRuntimeCarrierSelection | undefined {
    return this.get(subject, rustRuntimeCarrierKey);
  }

  getSelectedTargetCall(subject: ExtensionFactSubject | undefined): RustSelectedTargetSignature | undefined {
    return this.get(subject, rustSelectedCallKey);
  }

  getSelectedTargetOperation(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined {
    return this.get(subject, rustSelectedOperationKey);
  }

  getSelectedTargetProperty(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined {
    return this.get(subject, rustSelectedOperationKey);
  }

  getSelectedTargetElementAccess(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined {
    return this.get(subject, rustSelectedOperationKey);
  }

  getSelectedTargetOperator(subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined {
    return this.get(subject, rustSelectedOperationKey);
  }

  getSelectedTargetIteration(subject: ExtensionFactSubject | undefined): RustIterationSelection | undefined {
    const operation = this.get(subject, rustSelectedOperationKey);
    return operation?.operationKind === "iteration" && operation.resultType !== undefined
      ? operation as RustIterationSelection
      : undefined;
  }

  getTargetConversionFact(subject: ExtensionFactSubject | undefined): RustConversionSelection | undefined {
    return this.get(subject, rustConversionKey);
  }

  getArgumentPassingFact(subject: ExtensionFactSubject | undefined): ArgumentPassingFact | undefined {
    return this.get(subject, rustArgumentPassingKey);
  }
}

function isRustPlanKey<T>(
  key: RustPlanKey<T> | ExtensionFactKey<T>,
): key is RustPlanKey<T> {
  return typeof (key as { readonly id?: unknown }).id === "string" &&
    (key as { readonly id: string }).id.startsWith("tsonic.rust.");
}

export interface RustTargetAnalysis {
  readonly facts: RustSemanticModel;
  getEnumMemberConstant(node: Node): { readonly value: string | number } | undefined;
}
