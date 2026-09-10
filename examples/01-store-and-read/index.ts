// Alice stores her database connection string, then reads it back.

import { connect, PEOPLE, bytes, text } from "../rewall.ts";

const SECRET = "database.rewall.rewall-test-1.eth";
const CONNECTION_STRING = "postgres://app:hunter2@db.internal:5432/production";

const alice = connect(PEOPLE.alice);

// Alice must name someone who can recover this if she loses her wallet.
// The SDK refuses to create a secret without one.
await alice.create(SECRET, bytes(CONNECTION_STRING), {
    type: "generic",
    recovery: [PEOPLE.coldStorage.name],
});

console.log(`Stored a secret at ${SECRET}`);

// Reading takes one wallet signature. The plaintext never touches disk.
const value = text(await alice.get(SECRET));

console.log(`Read it back: ${value}`);
console.log(value === CONNECTION_STRING ? "\nIt matches." : "\nIt does not match, something is wrong.");
