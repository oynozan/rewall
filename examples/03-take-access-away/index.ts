// Bob leaves the team. Alice takes his access away and proves it stuck.

import { connect, PEOPLE, bytes, text } from "../rewall.ts";

const SECRET = "deploy-token.rewall.rewall-test-1.eth";
const TOKEN = "ghp_not_a_real_deploy_token";

const alice = connect(PEOPLE.alice);
const bob = connect(PEOPLE.bob);

await alice.create(SECRET, bytes(TOKEN), {
    type: "apikey",
    grantees: [PEOPLE.bob.name],
    recovery: [PEOPLE.coldStorage.name],
});

console.log(`Bob reads: ${text(await bob.get(SECRET))}`);

// Bob copies his wrapped key before he goes. This is what a real leaver would keep.
const stolen = await bob.get(SECRET);

await alice.revoke(SECRET, PEOPLE.bob.name);
console.log(`\nAlice revoked ${PEOPLE.bob.name}.`);

try {
    await bob.get(SECRET);
    console.log("Bob still reads it, which should not happen.");
} catch (error) {
    console.log(`Bob is locked out: ${(error as Error).name}`);
}

console.log(`Alice still reads: ${text(await alice.get(SECRET))}`);
console.log(`\nBob kept a copy of the old value: ${text(stolen)}`);
console.log("Rotate the real token too. Revoking does not un-see what was already seen.");
