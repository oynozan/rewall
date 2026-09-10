# Rewall

Permissionless secret infrastructure on ENSv2 Sepolia. `SPEC.md` is the source of truth for product and protocol behavior. Read it before touching code.

## Repo

- Monorepo. Origin `https://github.com/oynozan/rewall`.
- Clients per SPEC: TypeScript SDK (core, everything builds on it), CLI, MCP server, browser extension.

## Rules

- Never mock anything. No mock contracts, no stubbed RPC responses, no fake fixtures standing in for real ENS calls, no placeholder implementations. Code runs against real ENSv2 Sepolia or a real fork of it. If something cannot be built for real yet, stop and say so instead of faking it.
- Never guess. No invented function signatures, contract addresses, package versions, or costs. Verify against a primary source or against the chain, and if it cannot be verified, ask.
- Comments follow `.claude/skills/clean-comment-lines/SKILL.md`. One line each, describe the code as it is now, no change narration, no colons/semicolons/em dashes, no trailing period, `/* Section */` dividers, one file header only on long or complex files.
- Ponytail mode is on. Smallest working solution, stdlib and native platform first, no speculative abstractions, no scaffolding for later. Deliberate shortcuts get a `// ponytail:` marker naming the ceiling and the upgrade path.
- Never log, print, or write plaintext secrets or private keys. All crypto comes from libsodium, no custom primitives.
- Non-trivial logic leaves one runnable check behind. No test frameworks unless asked.

## ENSv2

- Docs index: https://docs.ens.domains/llms.txt
- Key pages: `/ensv2/overview`, `/ensv2/permissioned-registry`, `/ensv2/permissioned-resolver`, `/ensv2/enhanced-access-control`, `/ensv2/universal-resolver-v2`, `/ensv2/verifiable-factory`, `/ensv2/registry-hierarchy`, `/ensv2/tutorial-app-developers`, `/ensv2/tutorial-contract-developers`, `/ensv2/indexing`, `/web/ensv2-readiness`, `/learn/deployments#sepolia-ensv2-beta`.
- Contracts source: https://github.com/ensdomains/contracts-v2 pinned to commit `97a57293f3b4279d94b571e678edb53ce62638f4`, which produced the live deployment. `main` is 120 commits behind and carries a different, older address set.
- Libraries: raw viem 2.56.3 with `parseAbi` strings for both reads and writes. Never install `@ensdomains/ensjs` at any tag, its `registerName` uses a hardcoded ETH registry `0xDEDB9291...` while the canonical root points at `0xBDC85dD5...`, so names register into a tree nothing resolves against. `@ensdomains/ensjs-abi` is zero-dependency and optional.
- RPC: `https://ethereum-sepolia-rpc.publicnode.com`, the only free Sepolia endpoint serving `eth_simulateV1`. Tenderly is the archive fallback but silently truncates `eth_getLogs` at 50000 results.
- Resolvers are per account (UUPS proxy via VerifiableFactory). Never hardcode a resolver address, find it with `UniversalResolverV2.findResolver(name)`.
- Token IDs are mutable. Index and address names by labelhash, follow `TokenRegenerated`.
- Batch read: `UniversalResolverV2.resolve(dnsEncodedName, multicall(bytes[]))`. Batch write: `PermissionedResolver.multicall(bytes[])`.
- Roles are uint256 bitmaps, use bigint. Registry: `ROLE_REGISTRAR 1n<<0n`, `ROLE_UNREGISTER 1n<<12n`, `ROLE_RENEW 1n<<16n`, `ROLE_SET_SUBREGISTRY 1n<<20n`, `ROLE_SET_RESOLVER 1n<<24n`. Resolver: `ROLE_SET_ADDR 1n<<0n`, `ROLE_SET_TEXT 1n<<4n`, `ROLE_CLEAR 1n<<32n`. Admin variant is `role << 128n`. `ROOT_RESOURCE` is 0.
- Subname creation: parent owner deploys a UserRegistry via `VerifiableFactory.deployProxy(impl, salt, initData)`, then `setSubregistry(labelhash, registry)` on the parent registry, then `register(label, owner, subregistry, resolver, roleBitmap, expiry)` on it. Expiry is an absolute unix timestamp.
- Record-level text grants: `PermissionedResolver.authorizeTextRoles(dnsName, key, account, grant)`.

Sepolia ENSv2 addresses. All verified against `/learn/deployments` and confirmed to hold live bytecode.

```
RootRegistry                     0x8115186e8f2e0b0281e86ab91f0f48ba90364354
ETHRegistry                      0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2
ETHRegistrar                     0xa88553f454b77203b0d036a05c894d555eaaa2cc
UserRegistryImpl                 0x624a25d67b59d587752ebec8dded8827dae52050
UniversalResolverV2              0x4a1817d13e9cf196f471725176355c1234b63c70
PermissionedResolverImpl         0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e
PublicResolverV2                 0xe7b9a25607e02da8145e4eb1836ca539e53f11f7
VerifiableFactory                0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef
MockUSDC                         0x768f42455a2d082e23ceef7d51e5787c82d67a39   6dp, open mint
MockDAI                          0x5472c5725a00b7ba11f0794a79d08ade6f4683bd   18dp
StandardRentPriceOracle          0x8914b66260eb8c4fff795650c3ae8cd335958987
UpgradableUniversalResolverProxy 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe   viem default
```

Registrar constants, read live. MIN_COMMITMENT_AGE 60s, MAX_COMMITMENT_AGE 86400s, MIN_REGISTER_DURATION and GRACE_PERIOD 2419200s (28 days). Labels of 5+ chars cost 8.000021 USDC/yr, 4 chars 160.000009, 3 chars 640.000005, 1 to 2 chars revert. MockUSDC `mint` has no access control, so names cost only gas.

`makeCommitment` takes 7 args, `register` takes 8, the extra one is `paymentToken`. Every field must match or `register` reverts without saying which. `approve` the registrar before `register`, allowance from a fresh address is zero.

`VerifiableFactory.verifyContract(address)` takes one argument and reverts on failure. One salt is one proxy forever, so predict the address and `eth_getCode` before deploying or the bootstrap bricks on rerun.

Identity keys use `crypto_scalarmult_base(seed)`, never `crypto_box_seed_keypair`, which hashes the seed first and yields a different key. Ban `sodium.to_base64` and `from_base64`, they default to URL-safe unpadded.

## Plugins and skills

- Project skills (`.claude/skills/`): `clean-comment-lines` (load on every code edit), `chainlink-cre-skill`, `chainlink-cre-connect-skill`, `chainlink-confidential-ai-attester-skill`.
- Project plugins: `claude-md-management` (`/revise-claude-md`), `ralph-loop` (`/ralph-loop "<prompt>" --max-iterations N --completion-promise "<text>"`, `/cancel-ralph`).
- User plugins: `ponytail` (`/ponytail lite|full|ultra`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`), `superpowers`.
