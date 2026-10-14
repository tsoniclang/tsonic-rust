import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustPlanKey } from "./key.js";
import type { RustRecordWriter } from "./model.js";

export function createRustRecordFamily<T>(
  definition: RustPlanKey<T>,
  assertOpen: () => void,
  inherited?: RustRecordFamily<T>,
  onAdmission?: (value: T) => void,
): {
  readonly reader: RustRecordFamily<T>;
  readonly writer: RustRecordWriter<T>;
} {
  let values: WeakMap<ExtensionFactSubject, T> | undefined;
  const get = (subject: ExtensionFactSubject | undefined): T | undefined =>
    subject === undefined ? undefined : values?.get(subject) ?? inherited?.get(subject);
  return Object.freeze({
    reader: Object.freeze({ get }),
    writer: Object.freeze({
      get,
      set(subject: ExtensionFactSubject, value: T): void {
        assertOpen();
        const existing = get(subject);
        if (existing !== undefined && !definition.equals(existing, value)) {
          throw new Error(
            `Conflicting Rust semantic plan '${definition.id}' for one exact source subject.`,
          );
        }
        if (existing === undefined) {
          values ??= new WeakMap<ExtensionFactSubject, T>();
          values.set(subject, value);
        }
        onAdmission?.(value);
      },
    }),
  });
}
