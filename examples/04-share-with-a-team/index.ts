// Alice grants a secret to Bob's whole team at once, without naming anyone on it.

import { connect, PEOPLE, bytes, text } from "../rewall.ts";

const SECRET = "team-secret.rewall.rewall-test-1.eth";
const VALUE = "shared-across-the-whole-team";

const alice = connect(PEOPLE.alice);
const bob = connect(PEOPLE.bob);
const ci = connect(PEOPLE.ci);
const deploy = connect(PEOPLE.deploy);

// Bob publishes a team key, then hands a copy to each machine under his name.
await bob.subtree.init();
await bob.subtree.distribute([PEOPLE.ci.name, PEOPLE.deploy.name]);
console.log(`Bob shared his team key with ${PEOPLE.ci.name} and ${PEOPLE.deploy.name}.`);

await alice.create(SECRET, bytes(VALUE), {
    type: "generic",
    subtreeGrantees: [PEOPLE.bob.name],
    recovery: [PEOPLE.coldStorage.name],
});
console.log(`\nAlice granted the secret to ${PEOPLE.bob.name} and everything under it.`);

// Neither machine was named by Alice. Both can read.
console.log(`${PEOPLE.ci.name} reads: ${text(await ci.get(SECRET))}`);
console.log(`${PEOPLE.deploy.name} reads: ${text(await deploy.get(SECRET))}`);

// Removing a machine means changing the team key, then handing out the new one.
await bob.subtree.rotate();
console.log(`\nBob rotated the team key to version ${await bob.subtree.version()}.`);

await alice.grant(SECRET, PEOPLE.bob.name, { subtree: true });
await bob.subtree.distribute([PEOPLE.ci.name]);

console.log(`${PEOPLE.ci.name} still reads: ${text(await ci.get(SECRET))}`);

try {
    await deploy.get(SECRET);
    console.log(`${PEOPLE.deploy.name} still reads it, which should not happen.`);
} catch (error) {
    console.log(`${PEOPLE.deploy.name} is out: ${(error as Error).name}`);
}
