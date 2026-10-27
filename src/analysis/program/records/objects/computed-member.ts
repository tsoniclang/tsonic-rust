import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustComputedMemberEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustComputedMemberFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustComputedMemberProducer {
  readonly records: RustRecordFamily<RustComputedMemberFact>;
  evaluate(ast: AstReader, expression: Node, receiver: Node, key: Node,
    accessMode: RustComputedMemberFact["accessMode"], evaluateReceiver?: boolean): RustComputedMemberFact;
}

export function createRustComputedMemberProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustComputedMemberFact>,
): RustComputedMemberProducer {
  const family = createRustRecordFamily<RustComputedMemberFact>({
    id: "tsonic.rust.computedMember", equals: rustComputedMemberEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    evaluate(ast: AstReader, expression: Node, receiver: Node, key: Node,
      accessMode: RustComputedMemberFact["accessMode"], evaluateReceiver = true): RustComputedMemberFact {
      assertOpen();
      const kind = ast.kindName(key);
      const selected = Object.freeze({ receiver, key, accessMode, evaluateReceiver,
        evaluateKey: kind !== "KindStringLiteral" && kind !== "KindNumericLiteral" &&
          kind !== "KindNoSubstitutionTemplateLiteral",
      });
      const existing = family.reader.get(expression);
      if (existing !== undefined) {
        if (!rustComputedMemberEquals(existing, selected)) {
          failTargetAnalysisInvariant("tsonic-rust",
            "Conflicting Rust semantic plan 'tsonic.rust.computedMember' for one exact source subject.");
        }
        return existing;
      }
      family.writer.set(expression, selected);
      return selected;
    },
  });
}
