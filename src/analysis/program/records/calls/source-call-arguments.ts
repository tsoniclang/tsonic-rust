import type { Node } from "@tsonic/tsts";
import type { RustSourceCallArgumentEmission, RustSourceCallEvaluationEmission, RustSourceCallFact, RustSourceParameterEmission } from "../../../../target-model/records/calls/source-call-arguments.js";
import type { RustFinalizedOperationAbi } from "../../../../target-model/records/operations/finalized-operation.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { createRustRecordFamily } from "../family.js";

export function createRustSourceCallArgumentProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustSourceCallArgumentEmission>({ id: "tsonic.rust.sourceCallArgument", equals: (left, right) => left === right }, assertOpen);
  const evaluations = createRustRecordFamily<RustSourceCallEvaluationEmission>({ id: "tsonic.rust.sourceCallEvaluation", equals: (left, right) => left === right }, assertOpen);
  const parameters = new WeakMap<RustSourceCallFact, readonly RustSourceParameterEmission[]>();
  const providers = new WeakSet<RustFinalizedOperationAbi>();
  return Object.freeze({ records: Object.freeze({ sourceCallArgument: family.reader, sourceCallEvaluation: evaluations.reader,
    sourceCallParameters: Object.freeze({ get: (fact: RustSourceCallFact) => parameters.get(fact) }),
    providerArguments: Object.freeze({ get: (abi: RustFinalizedOperationAbi) => providers.has(abi) ? true : undefined }),
  }),
    provider(abi: RustFinalizedOperationAbi): void { assertOpen(); providers.add(abi); },
    call(node: Node, fact: RustSourceCallFact, value: RustSourceCallEvaluationEmission, selected: readonly RustSourceParameterEmission[]): void {
      assertOpen();
      if (parameters.has(fact)) failTargetAnalysisInvariant("tsonic-rust", "A source call ABI has one exact native argument owner.", node);
      parameters.set(fact, Object.freeze(selected));
      evaluations.writer.set(node, Object.freeze(value));
    },
    publish: (node: Node, value: RustSourceCallArgumentEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustSourceCallArgumentProducer = ReturnType<typeof createRustSourceCallArgumentProducer>;
