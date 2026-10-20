import type { AstReader, Node } from "@tsonic/tsts";
import type { RustProgramErrorOwner, TargetTypeRef } from "../../target-model/types/model.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import { rustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustNativeErrorJoinTargetType } from "../../target-model/types/native-error-joins.js";
import { selectRustProducerError, type RustProducerErrorContext } from "../callables/producer-errors.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/source-package-semantics.js";

export interface RustErrorTypeContext extends RustProducerErrorContext {
  readonly ast: Pick<AstReader, "getSourceFile" | "getFileName">;
  readonly components: RustSourcePackageComponentClassifications;
}

export function selectRustPhysicalProgramErrorOwner(
  declaration: Node,
  input: Pick<RustErrorTypeContext, "ast" | "components">,
): Extract<RustProgramErrorOwner, { readonly kind: "physical" }> | undefined {
  const file = input.ast.getSourceFile(declaration);
  const component = file === undefined ? undefined : input.components.componentForFile(input.ast.getFileName(file));
  if (component === undefined) return undefined;
  if (component.errorDomain === "runtime") return component.errorOwnerComponentId === undefined
    ? Object.freeze({ kind: "physical", domain: "runtime" }) : undefined;
  const owner = component.errorOwnerComponentId === undefined ? undefined : input.components.forComponent(component.errorOwnerComponentId);
  return owner?.errorDomain === "project" && owner.errorOwnerComponentId === owner.componentId
    ? Object.freeze({ kind: "physical", domain: "project", componentId: owner.componentId }) : undefined;
}

export function normalizeRustErrorType(
  carrier: TargetTypeRef,
  input: RustErrorTypeContext,
  declaration?: Node,
): TargetTypeRef | undefined {
  if (!isRustTargetTypeRef(carrier)) return undefined;
  const unavailable = {};
  const active = new Set<string>();
  const completed = new Map<string, TargetTypeRef>();
  let remaining = 4096;
  const normalize = (type: TargetTypeRef, owner: Node | undefined): TargetTypeRef => mapRustTargetTypes(type, selected => {
    if (--remaining < 0) throw unavailable;
    const program = rustProgramErrorOwner(selected);
    if (program !== undefined) {
      if (program.kind === "logical") {
        const physical = owner === undefined ? undefined : selectRustPhysicalProgramErrorOwner(owner, input);
        if (physical === undefined) throw unavailable;
        return rustProgramErrorTargetType(physical);
      }
      if (program.domain === "project") {
        const component = input.components.forComponent(program.componentId);
        if (component?.errorDomain !== "project" || component.errorOwnerComponentId !== program.componentId) throw unavailable;
      }
      return selected;
    }
    const reference = rustProducerErrorReference(selected);
    if (reference === undefined) {
      if (selected.kind === "target-specific" && selected.name === "producer-error") throw unavailable;
      return selected;
    }
    const key = closedMetadataKey(reference);
    const previous = completed.get(key);
    if (previous !== undefined) return previous;
    if (active.has(key) || active.size >= 128) throw unavailable;
    active.add(key);
    try {
      const selection = selectRustProducerError(reference, input);
      if (selection === undefined) throw unavailable;
      let result: TargetTypeRef;
      if (selection.kind === "carrier") result = normalize(selection.carrier, input.producers.forIdentity(reference.identity)!.declaration);
      else {
        const errors: TargetTypeRef[] = [];
        if (selection.effects.localErrors) {
          const physical = selectRustPhysicalProgramErrorOwner(selection.declaration, input);
          if (physical === undefined) throw unavailable;
          errors.push(rustProgramErrorTargetType(physical));
        }
        for (const source of selection.effects.nativeErrors) errors.push(normalize(source.errorType, selection.declaration));
        const file = input.ast.getSourceFile(selection.declaration);
        const joined = file === undefined ? undefined : rustNativeErrorJoinTargetType(input.ast.getFileName(file), errors);
        if (joined === undefined) throw unavailable;
        result = joined;
      }
      completed.set(key, result);
      return result;
    } finally { active.delete(key); }
  });
  try { return snapshotClosedMetadata(normalize(carrier, declaration)); }
  catch (error) { if (error === unavailable) return undefined; throw error; }
}
