# 4. Share with a whole team

Alice grants a secret to Bob's team. She never learns who is on it.

```bash
pnpm run 04
```

## The problem this solves

Bob runs two machines, `ci.rewall-test-2.eth` and `deploy.rewall-test-2.eth`.
Tomorrow he might add a third.

Alice does not want to grant each one. She does not want to be asked again every
time Bob's team changes. She wants to say "Bob's team" once.

## How it works

Bob has a second key called a team key. He publishes its public half on his name
and gives the private half to each machine, sealed so only that machine can open it.

Alice wraps the secret for the team key instead of for a person.

Any machine holding the team key can now open the secret. Alice wrapped it once.
She never saw the list of machines and does not need to.

## Removing a machine

Look at the second half of the output.

Bob bumps the team key to a new version. That invalidates every copy he handed
out, including the one held by the machine he is removing. He hands the new key
only to the machines that stay.

Alice re-grants to the new team key. The re-grant rotates the secret, which is
what actually locks the removed machine out.

Note the cost. Bumping the version locks out _everyone_ until Bob hands out the
new key. It is not surgical. That is the trade for Bob storing nothing.

## Where the team key comes from

Bob does not generate and store it. It is derived from his own key plus the
version number, so he can always work it out again. Nothing to back up, nothing
to lose. Changing the version is what makes a new one.
