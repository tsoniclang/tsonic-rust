import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustErrorRegionSelection } from "../errors/error-regions.js";
import type { RustRecordFamily } from "../program.js";

export interface RustSourceFileEmission {
  readonly instanceViewOwners: readonly Node[];
  readonly constructorViewOwners: readonly Node[];
  readonly classes: readonly {
    readonly definition: RustProjectTypeDefinition;
    readonly local: boolean;
    readonly polymorphic: boolean;
  }[];
  readonly initialization: {
    readonly required: boolean;
    readonly asynchronous: boolean;
    readonly region: RustErrorRegionSelection;
  };
}

export interface RustDefaultExportEmission {
  readonly expression: Node;
  readonly name: string;
  readonly carrier: TargetTypeRef;
}

export interface RustModuleBindingEmission {
  readonly name: string;
  readonly visibility: "public" | "crate";
  readonly initializer: Node | undefined;
  readonly staticString: string | undefined;
}

export interface RustSourceFileEmissionRecords {
  readonly sourceFileEmission: RustRecordFamily<RustSourceFileEmission>;
  readonly moduleHoistedCallable: RustRecordFamily<{ readonly carrier: TargetTypeRef }>;
  readonly moduleTypeForm: RustRecordFamily<"ordinary" | "polymorphic">;
  readonly defaultExport: RustRecordFamily<RustDefaultExportEmission>;
  readonly moduleBindingEmission: RustRecordFamily<RustModuleBindingEmission>;
}
