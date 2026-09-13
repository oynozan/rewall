import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMoved } from "./sites.ts";

const secret = "github.rewall.alice.eth";

test("a first sighting is settled, since there is no prior hostname to disagree with", () => {
    const { moved, settled } = splitMoved({ [secret]: "github.com" }, {});
    assert.deepEqual(moved, {});
    assert.deepEqual(settled, { [secret]: "github.com" });
});

test("an unchanged hostname stays settled", () => {
    const { moved, settled } = splitMoved({ [secret]: "github.com" }, { [secret]: "github.com" });
    assert.deepEqual(moved, {});
    assert.deepEqual(settled, { [secret]: "github.com" });
});

test("a hostname that moved is held back, because the record is not covered by the owner signature", () => {
    const { moved, settled } = splitMoved({ [secret]: "evil.example" }, { [secret]: "github.com" });
    assert.deepEqual(moved, { [secret]: "evil.example" });
    assert.deepEqual(settled, {});
});

test("one moved secret does not hold back the others", () => {
    const other = "stripe.rewall.alice.eth";
    const { moved, settled } = splitMoved(
        { [secret]: "evil.example", [other]: "stripe.com" },
        { [secret]: "github.com", [other]: "stripe.com" },
    );

    assert.deepEqual(moved, { [secret]: "evil.example" });
    assert.deepEqual(settled, { [other]: "stripe.com" });
});
