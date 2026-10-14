import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustPlanKey } from "./key.js";
import type { RustRecordWriter } from "./model.js";

export interface RustRecordConflict<T> {
  readonly existing: T;
  readonly incoming: T;
}

export function createRustRecordFamily<T>(
  definition: RustPlanKey<T>,
  assertOpen: () => void,
  inherited?: RustRecordFamily<T>,
  onAdmission?: (value: T) => void,
): {
  readonly reader: RustRecordFamily<T>;
  readonly writer: RustRecordWriter<T>;
  readonly admit: (subject: ExtensionFactSubject, value: T) => RustRecordConflict<T> | undefined;
  readonly reuse: (subject: ExtensionFactSubject, value: T) => RustRecordConflict<T> | undefined;
} {
  let values: WeakMap<ExtensionFactSubject, T> | undefined;
  const get = (subject: ExtensionFactSubject | undefined): T | undefined =>
    subject === undefined ? undefined : values?.get(subject) ?? inherited?.get(subject);
  const admit = (subject: ExtensionFactSubject, value: T, reuseExisting: boolean): RustRecordConflict<T> | undefined => {
    assertOpen();
    const existing = get(subject);
    if (existing !== undefined && !definition.equals(existing, value)) return { existing, incoming: value };
    if (existing !== undefined && reuseExisting) return undefined;
    if (existing === undefined) {
      values ??= new WeakMap<ExtensionFactSubject, T>();
      values.set(subject, value);
    }
    onAdmission?.(value);
    return undefined;
  };
  return Object.freeze({
    reader: Object.freeze({ get }),
    admit: (subject: ExtensionFactSubject, value: T): RustRecordConflict<T> | undefined => admit(subject, value, false),
    reuse: (subject: ExtensionFactSubject, value: T): RustRecordConflict<T> | undefined => admit(subject, value, true),
    writer: Object.freeze({
      get,
      set(subject: ExtensionFactSubject, value: T): void {
        if (admit(subject, value, false) !== undefined) {
          throw new Error(
            `Conflicting Rust semantic plan '${definition.id}' for one exact source subject.`,
          );
        }
      },
    }),
  });
}
