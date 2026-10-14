import type { AstReader, Node } from "@tsonic/tsts";
import { rustComputedMemberEquals } from "../../../target-model/records/equality.js";
import type { RustComputedMemberFact } from "../../../target-model/records/operation-selections.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustComputedMemberProducer {
  readonly records: RustRecordFamily<RustComputedMemberFact>;
  evaluate(ast: AstReader, expression: Node, receiver: Node, key: Node,
    accessMode: RustComputedMemberFact["accessMode"], evaluateReceiver?: boolean): void;
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
      accessMode: RustComputedMemberFact["accessMode"], evaluateReceiver = true): void {
      assertOpen();
      const kind = ast.kindName(key);
      family.writer.set(expression, Object.freeze({ receiver, key, accessMode, evaluateReceiver,
        evaluateKey: kind !== "KindStringLiteral" && kind !== "KindNumericLiteral" &&
          kind !== "KindNoSubstitutionTemplateLiteral",
      }));
    },
  });
}
