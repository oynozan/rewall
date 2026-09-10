// Alice stores an API key, then lets Bob read it. Bob never sends her anything.

import { connect, PEOPLE, bytes, text } from "../rewall.ts";

const SECRET = "stripe-key.rewall.rewall-test-1.eth";
const API_KEY = "sk_live_not_a_real_stripe_key";

const alice = connect(PEOPLE.alice);
const bob = connect(PEOPLE.bob);

await alice.create(SECRET, bytes(API_KEY), {
    type: "apikey",
    recovery: [PEOPLE.coldStorage.name],
});
console.log("Alice stored the API key.");

// Before the grant, Bob is just another stranger.
try {
    await bob.get(SECRET);
    console.log("Bob read it, which should not happen.");
} catch (error) {
    console.log(`Bob cannot read it yet: ${(error as Error).name}`);
}

// Alice only needs Bob's ENS name. She looks up his public key from it.
await alice.grant(SECRET, PEOPLE.bob.name);
console.log(`Alice granted ${PEOPLE.bob.name}.`);

console.log(`Bob reads: ${text(await bob.get(SECRET))}`);
