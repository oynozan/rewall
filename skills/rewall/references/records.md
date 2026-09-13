# The records

Every piece of Rewall state is an ENS text record, a small named string on a name. Keys are compared
as raw bytes, so `rewall.key.DEADBEEF` and `rewall.key.deadbeef` are different records. The names
come from `RECORD` in `sdk/src/records.ts`.

## On a secret subname

Such as `openai.rewall.alice.eth`.

| Record             | What it holds                                                                  |
| ------------------ | ------------------------------------------------------------------------------ |
| `rewall.v`         | Schema version, `3`.                                                           |
| `rewall.type`      | One of `generic`, `apikey`, `privkey`, `totp` or `receipt`.                    |
| `rewall.enc`       | `aes-256-gcm`, checked on every read.                                          |
| `rewall.blob`      | The ciphertext in base64, nonce then key commitment then padded text then tag. |
| `rewall.cid`       | Reserved for off chain ciphertext, not used.                                   |
| `rewall.key.<fp>`  | The data key sealed to the reader whose fingerprint is `fp`.                   |
| `rewall.owner`     | The ENS name that owns this secret.                                            |
| `rewall.grantees`  | Names granted directly, comma separated.                                       |
| `rewall.subtrees`  | Names whose whole subtree was granted.                                         |
| `rewall.recovery`  | Recovery entries, each a name or `guardians:<owner name>`.                     |
| `rewall.holders`   | Fingerprints that currently hold a sealed copy.                                |
| `rewall.auth.n`    | A counter that goes up on every list change.                                   |
| `rewall.auth.keys` | Role, name and approved key fingerprint for every party on the lists.          |
| `rewall.auth.sig`  | The owner's signature over the lists, checked before any rotation.             |
| `rewall.site`      | One exact hostname, `totp` only. Not covered by the signature.                 |
| `rewall.allow`     | Allowed hosts, enforced by the MCP server. Empty means deny every host.        |
| `rewall.created`   | Unix timestamp.                                                                |

The lists exist because a fingerprint is a hash. Nothing turns `rewall.key.<fp>` back into a name,
and ENS records cannot be enumerated, so a rotation needs the names on chain to know who to seal for
again. `rewall.holders` exists for the other direction, so a rotation can clear the copies of
everyone dropped. The owner signs the lists, so a party with write access cannot add a name and wait
for the next rotation to seal a key to it.

## On a participant name

Such as `alice.eth`.

| Record                  | What it holds                                                      |
| ----------------------- | ------------------------------------------------------------------ |
| `rewall.pubkey`         | The X25519 public key, base64.                                     |
| `rewall.index`          | Comma separated secret labels, read by `list`.                     |
| `rewall.subtree.pubkey` | The subtree public key, on a parent that grants to its subnames.   |
| `rewall.subtree.v`      | The subtree key version, bumped to remove a member.                |
| `rewall.subtree.key`    | The subtree private key sealed to this subname's key, on a subname. |
| `rewall.guardians`      | Comma separated guardian names.                                    |
| `rewall.guardian.<fp>`  | A Shamir share of the recovery key sealed to guardian `fp`.        |
| `rewall.reshare.<fp>`   | A guardian's share re-sealed to a replacement key, on the guardian. |
| `rewall.recovery.pubkey`| The public half of the guardian backed recovery key.               |
| `rewall.recovery.k`     | The guardian threshold.                                            |
| `rewall.shielded`       | A shielded address for private transfers. Optional.                |

## What is public

Everything except the plaintext. That a secret exists and its label, the owner's address, the time
of every change, the names on the lists, and the fingerprints of the readers are all readable by
anyone. Plaintext length is hidden by padding to a multiple of 256 bytes. Which name a blob belongs
to is bound into the ciphertext, so a blob copied to another name refuses to open.

## How a read works

1. Resolve the subname through `UniversalResolverV2` and read the records needed.
2. Refuse unless `rewall.v` is `3` and `rewall.enc` is `aes-256-gcm`.
3. Find `rewall.key.<fp>` for the caller's fingerprint, or for a subtree key the caller holds.
4. Unseal it to recover the data key. Check the key commitment. Decrypt `rewall.blob`. Unpad.

Plaintext stays in memory only.
