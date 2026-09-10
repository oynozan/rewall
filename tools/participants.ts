export const ETH_REGISTRAR = "0xa88553f454b77203b0d036a05c894d555eaaa2cc";
export const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
export const MOCK_USDC = "0x768f42455a2d082e23ceef7d51e5787c82d67a39";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

// Each participant is its own org, so cross-name access control is real rather than parent-controlled
export const PARTICIPANTS = [
    { role: "owner", index: 0, label: "rewall-test-1" },
    { role: "grantee", index: 1, label: "rewall-test-2" },
    { role: "stranger", index: 2, label: null },
    { role: "recovery", index: 3, label: "rewall-test-3" },
];

// Reserves the Rewall subtree so a participant keeps <secret>.<their name>.eth for their own use
export const NAMESPACE_LABEL = "rewall";

export const secretName = (secret: string, org: string) => `${secret}.${NAMESPACE_LABEL}.${org}.eth`;
