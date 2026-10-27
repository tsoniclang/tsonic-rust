import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProjectStructuralView } from "../../target-model/records/objects/project-structural-views.js";
import { analyzeRustFrozenReceiverCaptures } from "./frozen-receiver-captures.js";

import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/index.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustStructuralShapeLayoutPlan } from "./shapes/structural-shape-plan.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import type { RustFrozenWriteReceiver } from "../../target-model/records/storage/field-writes.js";

import type { RustFrozenDataWritePlan } from "../../target-model/records/storage/frozen-data.js";
import { createRustFrozenDataWriteRecords } from "../program/records/storage/frozen-data.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
export interface RustFrozenDataWriteRegistry extends RustFrozenDataWritePlan {
  initialize(input: {
    readonly jsEnabled: boolean;
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    readonly representations: RustObjectRepresentationPlan;
    readonly structuralShapes: RustStructuralShapeLayoutPlan;
    readonly sourceFiles: readonly SourceFile[];
    readonly isNativeNode: (node: Node) => boolean;
    readonly records: RustProgramRecords;
    readonly views: readonly RustProjectStructuralView[];
    readonly typeDefinitions: RustTypeDefinitions;
  }): void;
  seal(): RustFrozenDataWritePlan;
}

export function createRustFrozenDataWriteRegistry(): RustFrozenDataWriteRegistry {
  let current: RustFrozenDataWritePlan | undefined;
  const requireCurrent = (): RustFrozenDataWritePlan => {
    if (current === undefined) throw new Error("Frozen data-write analysis has not been initialized.");
    return current;
  };
  return {
    initialize(input) {
      if (current !== undefined) throw new Error("Frozen data-write analysis is already initialized.");
      const declarations = new Map<Node, RustFrozenWriteReceiver>();
      const fields = new Map<RustProjectTypeDefinition, ReadonlyMap<number, RustFrozenWriteReceiver>>();
      const captures = input.representations.receiverCaptures;
      const retained = input.jsEnabled ? analyzeRustFrozenReceiverCaptures({ ...input, captures }) : undefined;
      if (input.jsEnabled) for (const definition of input.projectTypes.definitions) {
        const representation = input.representations.representationFor(definition);
        const layout = input.projectTypes.objectLayoutForDefinition(definition);
        if (layout === undefined || representation === undefined || representation.kind === "value") continue;
        const mode = representation.kind === "shared-immutable" || representation.kind === "shared-mutable" ? "state" : "identity";
        const offset = input.projectTypes.externalBaseForDefinition(definition)?.fields.length ?? 0;
        const selected = new Map<number, RustFrozenWriteReceiver>();
        for (const field of layout.fields) {
          const name = input.ast.name(field.declaration);
          if (name !== undefined && input.ast.kindName(name) === "KindPrivateIdentifier") continue;
          declarations.set(field.declaration, mode);
          selected.set(offset + field.storageIndex, mode);
        }
        for (const member of input.ast.members(definition.declaration)) {
          if (member === undefined || input.ast.kindName(member) !== "KindMethodDeclaration" ||
            input.ast.hasModifierKind(member, "static")) continue;
          const name = input.ast.name(member);
          if (name === undefined || input.ast.kindName(name) === "KindPrivateIdentifier") continue;
          declarations.set(member, mode);
        }
        fields.set(definition, selected);
      }
      const projectFields = new Map<string, ReadonlyMap<number, RustFrozenWriteReceiver>>();
      for (const [definition, selected] of fields) {
        const carrier = rustSourceTypeCarrierValue(input.projectTypes.openCarrier(definition));
        if (carrier !== undefined) projectFields.set(JSON.stringify([carrier.fileName, carrier.typeName]), selected);
      }
      const structuralFields = new Map<string, ReadonlySet<number>>();
      if (input.jsEnabled) for (const carrier of new Set([
        ...input.structuralShapes.instances.map(shape => shape.carrier),
        ...input.structuralShapes.definitions.flatMap(shape => shape.sourceCarriers),
      ])) {
        const value = rustStructuralObjectCarrierValue(carrier);
        if (value?.representation !== "reference") continue;
        const writable = new Set<number>();
        for (let index = 0; index < value.fields.length; index += 1) {
          const field = input.structuralShapes.field(carrier, index);
          if (field !== undefined && field.storage !== "bound" &&
            (field.method !== true || field.methodPlan?.receiver === "independent") && field.nativeLayout === undefined) writable.add(index);
        }
        structuralFields.set(closedMetadataKey(carrier), writable);
      }
      current = createRustFrozenDataWriteRecords({ declarations, projectFields, structuralFields, retained });
    },
    receiverFor: (storage, carrier, index) => requireCurrent().receiverFor(storage, carrier, index),
    receiverForDeclaration: declaration => requireCurrent().receiverForDeclaration(declaration),
    capturesFieldIdentity: (declaration, reference) => requireCurrent().capturesFieldIdentity(declaration, reference),
    seal: requireCurrent,
  };
}
