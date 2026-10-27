import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustSourceCallEffectsFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustNativeCallableCall } from "../../../../target-model/records/native/native-protocols.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSourceCallEffectsProducer {
  readonly records: RustRecordFamily<RustSourceCallEffectsFact>;
  nativeInput(input: RustNativeCallableCall): void;
  selected(subject: Node, invocation: RustSourceCallEffectsFact["invocation"],
    awaiting: RustSourceCallEffectsFact["awaiting"], unionBranches?: RustSourceCallEffectsFact["unionBranches"]): void;
}

export function createRustSourceCallEffectsProducer(
  assertOpen: () => void,
  inherited?: RustSourceCallEffectsProducer["records"],
): RustSourceCallEffectsProducer {
  const family = createRustRecordFamily<RustSourceCallEffectsFact>({
    id: "tsonic.rust.sourceCallEffects", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    nativeInput(input: RustNativeCallableCall): void {
      assertOpen();
      family.writer.set(input.node, {
        invocation: "fallible", awaiting: input.completion === undefined ? "not-applicable" : "fallible",
        nativeInput: { invocationError: input.invocationError, invocationErrorSource: input.invocationErrorSource,
          awaitErrors: input.awaitErrors, awaitErrorSources: input.awaitErrorSources },
      });
    },
    selected(subject: Node, invocation: RustSourceCallEffectsFact["invocation"],
      awaiting: RustSourceCallEffectsFact["awaiting"], unionBranches?: RustSourceCallEffectsFact["unionBranches"]): void {
      assertOpen();
      family.writer.set(subject, { ...(unionBranches === undefined ? {} : { unionBranches }), invocation, awaiting });
    },
  });
}
