/**
 * Operator blocks are sent on first turn, operator change (incl. return),
 * or content hash change — never every turn.
 */
import {
  hashOperatorBlock,
  shouldSendOperatorBlock,
} from "../agent/session.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  const hA = hashOperatorBlock("block-A");
  const hB = hashOperatorBlock("block-B");
  assert(hA !== hB, "different blocks hash differently");
  assert(hashOperatorBlock("block-A") === hA, "sha256 is stable");

  const metaA = { lastOperatorId: "A", lastOperatorBlockHash: hA };

  assert(
    shouldSendOperatorBlock(true, "A", hA, metaA),
    "first turn always sends, even when hash matches (resume miss / new session)",
  );
  assert(
    shouldSendOperatorBlock(true, "A", hA, undefined),
    "first turn with empty meta sends",
  );

  assert(
    !shouldSendOperatorBlock(false, "A", hA, metaA),
    "same operator + same hash omits",
  );

  assert(
    shouldSendOperatorBlock(false, "B", hB, metaA),
    "operator change sends",
  );

  const metaB = { lastOperatorId: "B", lastOperatorBlockHash: hB };
  assert(
    shouldSendOperatorBlock(false, "A", hA, metaB),
    "A→B→A return sends (map-by-operator would skip this)",
  );

  assert(
    shouldSendOperatorBlock(false, "A", hB, metaA),
    "same operator + changed hash sends (USER / SOUL / CONTEXT)",
  );

  console.log("check:operator-block OK");
}

main();
