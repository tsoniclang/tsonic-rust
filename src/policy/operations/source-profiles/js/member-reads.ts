import type { RustSelectedSourceMemberIdentity } from "../../../evidence/selected-source.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { JsOperationRequest, JsOperationSelection } from "./model.js";
import { selectJsSurfaceOperation } from "./selection.js";

export function selectJsSurfaceMemberRead(
  members: readonly RustSelectedSourceMemberIdentity[],
  request: Omit<JsOperationRequest, "ownerName" | "memberName" | "operationKind"> &
    { readonly operationKind: "property" | "indexer" },
  readonly: boolean,
  definitions: RustTypeDefinitions,
): JsOperationSelection | undefined {
  const selections = members.map(member => member?.profile === "js"
    ? selectJsSurfaceOperation({ ...request, ownerName: member.ownerName, memberName: member.memberName,
      }, definitions) : undefined);
  const first = selections[0];
  if (first?.fact.kind !== "provider-operation" || first.callback !== undefined) return undefined;
  const { operationId: _operationId, indexedLocationMethod: _location, ...read } = first.fact;
  const locations = new Set<string>();
  for (const selected of selections) {
    if (selected?.fact.kind !== "provider-operation" || selected.callback !== undefined ||
      !closedMetadataEquals(first.resultCarrier, selected.resultCarrier) ||
      !closedMetadataEquals(first.parameterCarriers, selected.parameterCarriers)) return undefined;
    const { operationId: _selectedId, indexedLocationMethod, ...candidate } = selected.fact;
    if (!closedMetadataEquals(read, candidate)) return undefined;
    if (indexedLocationMethod !== undefined) locations.add(indexedLocationMethod);
  }
  if (locations.size > 1) return undefined;
  const indexedLocationMethod = readonly ? undefined : [...locations][0];
  const fact = { ...read, operationId: first.fact.operationId,
    ...(indexedLocationMethod === undefined ? {} : { indexedLocationMethod }) };
  return { ...first, fact };
}

export function selectJsSurfaceMemberWrite(
  members: readonly RustSelectedSourceMemberIdentity[],
  request: Omit<JsOperationRequest, "ownerName" | "memberName" | "operationKind"> &
    { readonly operationKind: "property-set" | "index-set" },
  readonly: boolean,
  definitions: RustTypeDefinitions,
): JsOperationSelection | undefined {
  if (readonly) return undefined;
  const read = selectJsSurfaceMemberRead(members, { ...request,
    operationKind: request.operationKind === "index-set" ? "indexer" : "property",
    argumentCarriers: request.argumentCarriers?.slice(0, -1),
  }, readonly, definitions);
  if (read === undefined) return undefined;
  const selections = members.flatMap(member => {
    const selected = selectJsSurfaceOperation({ ...request, ownerName: member.ownerName, memberName: member.memberName }, definitions);
    return selected === undefined ? [] : [selected];
  });
  const first = selections[0];
  if (first?.fact.kind !== "runtime-set" || first.callback !== undefined) return undefined;
  const { operationId: _operationId, ...expected } = first.fact;
  for (const selected of selections) {
    if (selected.fact.kind !== "runtime-set" || selected.callback !== undefined ||
      !closedMetadataEquals(first.parameterCarriers, selected.parameterCarriers)) return undefined;
    const { operationId: _selectedId, ...candidate } = selected.fact;
    if (!closedMetadataEquals(expected, candidate)) return undefined;
  }
  return first;
}
