import {
  tsonicNativePointerOperationFactKey,
  tsonicSafetyBuilderFactKey,
  tsonicUnsafeContextFactKey,
} from "@tsonic/source-core/facts";
import type {
  TsonicNativePointerOperationFact,
  TsonicSafetyBuilderFact,
  TsonicUnsafeContextFact,
} from "@tsonic/source-core/facts";
import type {
  ExtensionFactSubject,
  ReadonlySourceFactResolver,
} from "@tsonic/tsts";

export function readRustSourceUnsafeContext(
  sourceFacts: ReadonlySourceFactResolver,
  subject: ExtensionFactSubject | undefined,
): TsonicUnsafeContextFact | undefined {
  return subject === undefined
    ? undefined
    : sourceFacts.getFact(subject, tsonicUnsafeContextFactKey);
}

export function readRustSourceNativePointerOperation(
  sourceFacts: ReadonlySourceFactResolver,
  subject: ExtensionFactSubject | undefined,
): TsonicNativePointerOperationFact | undefined {
  return subject === undefined
    ? undefined
    : sourceFacts.getFact(subject, tsonicNativePointerOperationFactKey);
}

export function readRustSourceSafetyBuilder(
  sourceFacts: ReadonlySourceFactResolver,
  subject: ExtensionFactSubject | undefined,
): TsonicSafetyBuilderFact | undefined {
  return subject === undefined
    ? undefined
    : sourceFacts.getFact(subject, tsonicSafetyBuilderFactKey);
}
