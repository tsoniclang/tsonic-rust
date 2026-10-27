import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../program.js";

export interface RustTemplateStringEmission {
  readonly head: string;
  readonly parts: readonly { readonly expression: Node; readonly string: boolean; readonly literal: string }[];
}

export interface RustTemplateStringRecords {
  readonly templateString: RustRecordFamily<RustTemplateStringEmission>;
}
