import type { TargetTypeRef } from "../types/model.js";

import type { RustValueConversion } from "../operations/model.js";
import { type RustProviderRecordAbsentField } from "./provider-record-absence.js";

export interface RustProviderRecordCopy {
  readonly kind: "provider-record-copy";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly completion: "complete" | "default";
  readonly absentFields: readonly RustProviderRecordAbsentField[];
  readonly fields: readonly {
    readonly storageIndex: number;
    readonly sourceCarrier: TargetTypeRef;
    readonly carrier: TargetTypeRef;
    readonly targetName: string;
    readonly conversion?: RustValueConversion;
  }[];
}
