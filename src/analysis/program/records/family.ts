import type { ExtensionFactSubject } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";

interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T) => void;
}

export interface RustRecordConflict<T> {
  readonly existing: T;
  readonly incoming: T;
}

export function createRustRecordFamily<T>(
  definition: {
    readonly id: string;
    readonly equals: (left: T, right: T) => boolean;
  },
  assertOpen: () => void,
  inherited?: RustRecordFamily<T>,
  onAdmission?: (value: T) => void,
): {
  readonly reader: RustRecordFamily<T>;
  readonly writer: RustRecordWriter<T>;
  readonly admit: (subject: ExtensionFactSubject, value: T) => RustRecordConflict<T> | undefined;
} {
  let values: WeakMap<ExtensionFactSubject, T> | undefined;
  const get = (subject: ExtensionFactSubject | undefined): T | undefined => {
    if (subject === undefined) return undefined;
    const selected = values?.get(subject);
    return selected === undefined ? inherited?.get(subject) : selected;
  };
  const admit = (subject: ExtensionFactSubject, value: T): RustRecordConflict<T> | undefined => {
    assertOpen();
    if (values?.has(subject)) {
      failTargetAnalysisInvariant("tsonic-rust",
        `Duplicate Rust semantic plan '${definition.id}' for one exact source subject.`);
    }
    const existing = inherited?.get(subject);
    if (existing !== undefined && !definition.equals(existing, value)) return { existing, incoming: value };
    const canonical = existing === undefined ? value : existing;
    onAdmission?.(canonical);
    values ??= new WeakMap<ExtensionFactSubject, T>();
    values.set(subject, canonical);
    return undefined;
  };
  return Object.freeze({
    reader: Object.freeze({ get }),
    admit,
    writer: Object.freeze({
      get,
      set(subject: ExtensionFactSubject, value: T): void {
        if (admit(subject, value) !== undefined) {
          failTargetAnalysisInvariant("tsonic-rust",
            `Conflicting Rust semantic plan '${definition.id}' for one exact source subject.`,
          );
        }
      },
    }),
  });
}
