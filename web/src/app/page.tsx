import Image from "next/image";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

import { AgentChat } from "@/src/components/landing/agent-chat";
import { BRANDS } from "@/src/components/landing/brands";
import { CopyCommand } from "@/src/components/landing/copy-command";
import { AgentFlow, TransfersFlow, TwoFactorFlow } from "@/src/components/landing/flows";
import { CounterMark, PaddingMark, RecordsMark, SlotsMark } from "@/src/components/landing/figures";
import GradientWaves from "@/src/components/landing/gradient-waves";
import { HeroCta } from "@/src/components/landing/hero-cta";
import { HeroDither } from "@/src/components/landing/hero-dither";
import LightRays from "@/src/components/landing/light-rays";
import { OtpDemo } from "@/src/components/landing/otp-demo";
import "./landing.css";

export const metadata: Metadata = {
    title: { absolute: "Rewall — Permissionless secret infrastructure" },
    description:
        "Secrets encrypted on your device and stored under an ENS name you own. No server holds them, no account system gates them, and no party can read them except the names they were encrypted to.",
};

const STRIPES = Array.from({ length: 13 }, (_, i) => {
    const edge = Math.abs(i - 6) / 6;
    return { height: `${Math.round(30 + edge * 58)}%`, opacity: +(0.2 + edge * 0.12).toFixed(3) };
});

const REPO = "https://github.com/oynozan/rewall";
const DOCS = "https://docs.rewall.me";

const MARKS = [
    {
        label: "Padded blobs",
        body: "Four bytes of length, the plaintext, then zeros, out to a multiple of 256. Every credential under 252 bytes produces a blob of identical length.",
        art: <PaddingMark />,
    },
    {
        label: "Signed lists",
        body: "The owner signs the grantee lists and the key approved for each name. A rotation that cannot verify them refuses to run.",
        art: <CounterMark />,
    },
    {
        label: "Wrap records",
        body: "One record per key, holding the data key sealed to a reader’s X25519 public key. A rotation writes the new set and clears whoever left.",
        art: <SlotsMark />,
    },
    {
        label: "One resolver",
        body: "Every name an account owns points at the same resolver. Records are keyed by namehash, so one resolver holds every secret without collision.",
        art: <RecordsMark />,
    },
];

const HOW = `${DOCS}/how-it-works`;

/* Each preview quotes the paragraph that follows the step's own sentence on the docs page */
const WORKS = [
    {
        title: "Name",
        anchor: "name",
        icon: "contacts",
        body: "A secret is a subname under an ENS name you own.",
        preview:
            "The subname points at the one resolver your account owns. Every record a secret needs lives on that resolver under the subname's namehash, so one resolver holds every secret without them colliding.",
    },
    {
        title: "Seal",
        anchor: "seal",
        icon: "lock",
        body: "The value is encrypted on your device under a random key. Only ciphertext reaches the chain.",
        preview:
            "The client makes a fresh random 32 byte key, pads the plaintext to a multiple of 256 bytes so every short credential comes out the same length, and encrypts it with AES-256-GCM.",
    },
    {
        title: "Share",
        anchor: "share",
        icon: "share",
        body: "That key is sealed to each reader's public key and written as one record per reader.",
        preview:
            "Every participant publishes an X25519 public key under their name as rewall.pubkey. To share a secret, the client seals the data key to a reader's public key with a libsodium sealed box.",
    },
    {
        title: "Open",
        anchor: "open",
        icon: "unlock",
        body: "A reader unseals their own copy with the key their wallet derives. Nobody else can.",
        preview:
            "The private key is never stored in plaintext. The reader's wallet signs one fixed message, the signature is hashed, and the result is the X25519 secret key.",
    },
];

const FAQ_LEFT = [
    [
        "Where is a secret actually stored?",
        "In ENS text records on the secret’s own subname, on ENSv2 Sepolia. The ciphertext sits inline in a record on that name. There is no offchain storage, no content addressing, and nothing for us to host.",
    ],
    [
        "What happens if I lose my wallet?",
        "The SDK refuses to create a secret wrapped only to you, so a recovery grantee always exists. That is either a second name backed by a cold wallet, or k of n guardians who each hold a Shamir share of a recovery key nobody holds whole.",
    ],
    [
        "Can Rewall read my secrets?",
        "There is nothing to read them with. No Rewall service holds a key that opens a secret, and every decryption runs in your own browser or on your own machine. A secret opens only for a name it was sealed to.",
    ],
    [
        "Is revoking someone retroactive?",
        "No, and a public chain makes that plainer than usual. The transaction that granted a name is permanently in history and carries its wrap, so whoever held that key can still decrypt the old value from an archive node. Treat a grant as handing over a copy, and rotate the credential itself when someone leaves.",
    ],
];

const FAQ_RIGHT = [
    [
        "How is my identity key derived?",
        "Your wallet signs one fixed EIP-712 payload. The signature is reduced to canonical form, hashed into a 32-byte seed, and used directly as an X25519 scalar. Sign it only in Rewall: whoever collects that signature reads every secret shared with you, permanently.",
    ],
    [
        "What does an agent receive?",
        "A result, never a value. The MCP server decrypts inside its own process, attaches the secret to the request it was allowed to make, and hands back the response with the value scrubbed out.",
    ],
    [
        "Do I need an ENS name?",
        "To own secrets, yes, because a secret is a subname under your namespace. To be granted one, a name that publishes your key. To decrypt it afterwards, nothing but the key itself.",
    ],
    [
        "What does it cost to run?",
        "Gas, and the ENS registration. Rewall charges nothing and has no account to open. On Sepolia the registrar is paid in a mock token whose mint is open, so a name costs only the gas to register it.",
    ],
];

function Code() {
    return (
        <pre>
            <span className="t-com">{"// one key, derived from a signature, never written down"}</span>
            {"\n"}
            <span className="t-key">await</span> <span className="t-id">rewall</span>
            <span className="t-punc">.</span>
            <span className="t-fn">identity</span>
            <span className="t-punc">();</span>
            {"\n\n"}
            <span className="t-key">await</span> <span className="t-id">rewall</span>
            <span className="t-punc">.</span>
            <span className="t-fn">create</span>
            <span className="t-punc">(</span>
            <span className="t-str">&quot;openai.rewall.alice.eth&quot;</span>
            <span className="t-punc">,</span> <span className="t-id">key</span>
            <span className="t-punc">, {"{"}</span>
            {"\n    "}
            <span className="t-prop">type</span>
            <span className="t-punc">:</span> <span className="t-str">&quot;apikey&quot;</span>
            <span className="t-punc">,</span>
            {"\n    "}
            <span className="t-prop">grantees</span>
            <span className="t-punc">: [</span>
            <span className="t-str">&quot;ci.alice.eth&quot;</span>
            <span className="t-punc">],</span>
            {"\n    "}
            <span className="t-prop">recovery</span>
            <span className="t-punc">: [</span>
            <span className="t-str">&quot;vault.alice.eth&quot;</span>
            <span className="t-punc">],</span>
            {"\n    "}
            <span className="t-prop">allow</span>
            <span className="t-punc">: [</span>
            <span className="t-str">&quot;api.openai.com&quot;</span>
            <span className="t-punc">],</span>
            {"\n"}
            <span className="t-punc">{"});"}</span>
            {"\n\n"}
            <span className="t-com">{"// a wrap for bob, then a rotation that strips it"}</span>
            {"\n"}
            <span className="t-key">await</span> <span className="t-id">rewall</span>
            <span className="t-punc">.</span>
            <span className="t-fn">grant</span>
            <span className="t-punc">(</span>
            <span className="t-str">&quot;openai.rewall.alice.eth&quot;</span>
            <span className="t-punc">,</span> <span className="t-str">&quot;bob.eth&quot;</span>
            <span className="t-punc">);</span>
            {"\n"}
            <span className="t-key">await</span> <span className="t-id">rewall</span>
            <span className="t-punc">.</span>
            <span className="t-fn">revoke</span>
            <span className="t-punc">(</span>
            <span className="t-str">&quot;openai.rewall.alice.eth&quot;</span>
            <span className="t-punc">,</span> <span className="t-str">&quot;bob.eth&quot;</span>
            <span className="t-punc">);</span>
        </pre>
    );
}

export default function Home() {
    return (
        <div className="lp">
            <header className="band nav">
                <div className="frame">
                    <a href="#top" aria-label="Rewall home">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="nav-mark" src="/logo.svg" alt="Rewall" width={470} height={230} />
                    </a>
                    <nav className="nav-links">
                        <a href="#works">How it works</a>
                        <a href="#protocol">Protocol</a>
                        <a href="#clients">Clients</a>
                        <a href="#faq">FAQ</a>
                    </nav>
                    <div className="nav-cta">
                        <a className="btn btn-solid" href="/dashboard">
                            Dashboard
                        </a>
                    </div>
                </div>
            </header>

            <section className="band" id="top">
                <div className="frame hero-frame">
                    <HeroDither />
                    <div className="hero">
                        <h1 className="rise rise-1">
                            On-chain secrets
                            <br />
                            <span>made simple</span>
                        </h1>
                        <p className="lead rise rise-2">
                            Rewall encrypts a secret on your device and stores it under your ENS subnames
                        </p>
                        <div className="hero-cta rise rise-3">
                            <HeroCta label="Dashboard" href="/dashboard" />
                            <a className="btn btn-lg" href={DOCS} target="_blank" rel="noreferrer">
                                Read Docs
                            </a>
                        </div>
                        <Image
                            className="hero-art rise rise-4"
                            src="/rewall-real.png"
                            alt=""
                            width={1254}
                            height={1254}
                            draggable={false}
                            priority
                        />
                    </div>
                    <div className="brands">
                        <ul>
                            {BRANDS.map((b) => (
                                <li key={b.name} style={{ "--brand": b.hex } as CSSProperties}>
                                    {b.mark}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>

            <section className="band" id="works">
                <div className="frame works-frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="waves" aria-hidden="true">
                        <GradientWaves
                            horizonColor="#1a1a18"
                            waveColor="#262623"
                            crestColor="#b4b4ad"
                            speed={0.3}
                            amplitude={2.4}
                            waveScale={1.1}
                            fogDepth={30}
                            brightness={1}
                            opacity={0.5}
                            detail="low"
                            mouseInteraction={false}
                            grainIntensity={0.04}
                        />
                    </div>
                    <div className="head head-center">
                        <h2>How it works.</h2>
                        <p className="lead">Name a secret, encrypt it, and give access to the people you choose.</p>
                    </div>
                    <div className="works" data-works>
                        {WORKS.map(({ title, anchor, icon, body, preview }) => (
                            <a
                                key={anchor}
                                className="wk-step"
                                href={`${HOW}#${anchor}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <h3>{title}</h3>
                                <p>{body}</p>
                                <span className="wk-card" aria-hidden="true">
                                    <span className="wk-card-icon">
                                        <Image src={`/arcticons/${icon}.svg`} width={28} height={28} alt="" />
                                    </span>
                                    <span className="wk-card-body">
                                        <b>{title}</b>
                                        <span>{preview}</span>
                                        <small>
                                            {HOW.replace("https://", "")}#{anchor}
                                        </small>
                                    </span>
                                </span>
                            </a>
                        ))}
                    </div>
                </div>
            </section>

            <section className="band" id="protocol">
                <div className="frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="head">
                        <h2>Nothing here asks you to trust us.</h2>
                        <p className="lead">
                            A secret is one subname, a handful of text records, and a ciphertext nobody but its readers
                            can open. The mechanism is specified in full and small enough to read end to end.
                        </p>
                    </div>
                    <div className="feat">
                        <div className="feat-panel">
                            <div className="code">
                                <div className="code-bar">
                                    <i />
                                    <i />
                                    <i />
                                    <span>secrets.ts</span>
                                </div>
                                <Code />
                            </div>
                            <div>
                                <h3>The SDK is the protocol</h3>
                                <p className="lead">
                                    Encryption uses platform WebCrypto for AES-256-GCM and libsodium for the sealed-box
                                    wraps. No hand-rolled primitives, and no algorithm the spec does not name.
                                </p>
                            </div>
                        </div>
                        <div className="feat-cells">
                            {MARKS.map((m) => (
                                <div className="cell" key={m.label}>
                                    {m.art}
                                    <h4>{m.label}</h4>
                                    <p>{m.body}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="band flows" id="flows">
                <div className="frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="flow-grid">
                        <figure className="flow">
                            <figcaption>
                                <h2>Semi&#8209;Confidential Transfers</h2>
                                <p>Both sides touch the vault. The chain never records them touching each other.</p>
                            </figcaption>
                            <TransfersFlow />
                        </figure>
                        <figure className="flow">
                            <figcaption>
                                <h2>Two&#8209;Factor Codes</h2>
                                <p>
                                    A code appears only for the exact hostname stored on the secret. A lookalike gets
                                    nothing.
                                </p>
                            </figcaption>
                            <TwoFactorFlow />
                        </figure>
                        <figure className="flow">
                            <figcaption>
                                <h2>Agents That Cannot Leak</h2>
                                <p>
                                    The key circles inside the tool process. It reaches allowed hosts and never the
                                    model.
                                </p>
                            </figcaption>
                            <AgentFlow />
                        </figure>
                    </div>
                </div>
            </section>

            <section className="band" id="clients">
                <div className="frame rays-frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="rays" aria-hidden="true">
                        <LightRays
                            raysOrigin="top-center"
                            raysColor="#ffffff"
                            saturation={0}
                            followMouse={false}
                            mouseInfluence={0}
                            raysSpeed={0.7}
                            lightSpread={1.1}
                            rayLength={1.5}
                            fadeDistance={1.1}
                        />
                    </div>
                    <div className="head">
                        <h2>The same identity, wherever you work.</h2>
                        <p className="lead">
                            One EOA wallet derives one key, so every client resolves to the same reader. Nothing syncs,
                            because there is nothing to sync.
                        </p>
                    </div>
                    <div className="bento">
                        <div className="b-cell">
                            <h3>TypeScript SDK</h3>
                            <p>Read and write secrets from your own code. Everything else here is a surface over it.</p>
                            <div className="b-panel">
                                <pre className="b-panel-body b-code-body">
                                    <span className="t-key">const</span> <span className="t-id">name</span> ={" "}
                                    <span className="t-str">&quot;db.rewall.rewall-test-1.eth&quot;</span>
                                    <span className="t-punc">;</span>
                                    {"\n\n"}
                                    <span className="t-key">await</span> <span className="t-id">rewall</span>
                                    <span className="t-punc">.</span>
                                    <span className="t-fn">create</span>
                                    <span className="t-punc">(</span>
                                    <span className="t-id">name</span>
                                    <span className="t-punc">,</span> <span className="t-id">value</span>
                                    <span className="t-punc">, {"{"}</span>
                                    {"\n  "}
                                    <span className="t-id">type</span>
                                    <span className="t-punc">:</span> <span className="t-str">&quot;dburl&quot;</span>
                                    <span className="t-punc">,</span>
                                    {"\n  "}
                                    <span className="t-id">recovery</span>
                                    <span className="t-punc">:</span> <span className="t-punc">[</span>
                                    <span className="t-str">&quot;rewall-test-3.eth&quot;</span>
                                    <span className="t-punc">],</span>
                                    {"\n"}
                                    <span className="t-punc">{"});"}</span>
                                    {"\n\n"}
                                    <span className="t-key">const</span> <span className="t-id">secret</span> ={" "}
                                    <span className="t-key">await</span> <span className="t-id">rewall</span>
                                    <span className="t-punc">.</span>
                                    <span className="t-fn">get</span>
                                    <span className="t-punc">(</span>
                                    <span className="t-id">name</span>
                                    <span className="t-punc">);</span>
                                    {"\n\n"}
                                    <span className="t-com">{"// Uint8Array, decrypted in memory"}</span>
                                </pre>
                            </div>
                        </div>

                        <div className="b-cell">
                            <h3>Grant and revoke</h3>
                            <p>Hand a secret to another ENS name, then take it back. The value itself never moves.</p>
                            <div className="b-panel">
                                <pre className="b-panel-body b-code-body">
                                    <span className="t-key">await</span> <span className="t-id">rewall</span>
                                    <span className="t-punc">.</span>
                                    <span className="t-fn">grant</span>
                                    <span className="t-punc">(</span>
                                    <span className="t-id">name</span>
                                    <span className="t-punc">,</span>{" "}
                                    <span className="t-str">&quot;rewall-test-2.eth&quot;</span>
                                    <span className="t-punc">);</span>
                                    {"\n\n"}
                                    <span className="t-com">{"// Their key gets a wrap of its own"}</span>
                                    {"\n\n"}
                                    <span className="t-key">await</span> <span className="t-id">rewall</span>
                                    <span className="t-punc">.</span>
                                    <span className="t-fn">revoke</span>
                                    <span className="t-punc">(</span>
                                    <span className="t-id">name</span>
                                    <span className="t-punc">,</span>{" "}
                                    <span className="t-str">&quot;rewall-test-2.eth&quot;</span>
                                    <span className="t-punc">);</span>
                                    {"\n\n"}
                                    <span className="t-com">{"// Rotates, so the old wrap opens nothing"}</span>
                                </pre>
                            </div>
                        </div>

                        <div className="b-cell">
                            <h3>Agent server</h3>
                            <p>An agent spends a secret it is never given, and the reply comes back with it removed.</p>
                            <div className="b-panel">
                                <AgentChat />
                            </div>
                        </div>

                        <div className="b-cell">
                            <h3>Browser extension</h3>
                            <p>Authenticator codes that fill on an exact hostname and never submit themselves.</p>
                            <div className="b-panel">
                                <OtpDemo />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="band" id="faq">
                <div className="frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="head head-center">
                        <h2>Questions worth asking first.</h2>
                    </div>
                    <div className="faq">
                        <div>
                            {FAQ_LEFT.map(([q, a]) => (
                                <details key={q}>
                                    <summary>{q}</summary>
                                    <p>{a}</p>
                                </details>
                            ))}
                        </div>
                        <div>
                            {FAQ_RIGHT.map(([q, a]) => (
                                <details key={q}>
                                    <summary>{q}</summary>
                                    <p>{a}</p>
                                </details>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="band" id="skill">
                <div className="frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="head head-center">
                        <h2>Teach your AI about Rewall.</h2>
                        <p className="lead">
                            One command installs a skill that tells Claude Code, Cursor and other agents what Rewall is,
                            how a secret is stored and shared, and how to build on it.
                        </p>
                    </div>
                    <div className="skill-row">
                        <CopyCommand />
                    </div>
                </div>
            </section>

            <footer className="band closer">
                <div className="frame">
                    <div className="wall" aria-hidden="true" />
                    <div className="closer-stage">
                        <div className="closer-copy">
                            <div className="stripes" aria-hidden="true">
                                {STRIPES.map((bar, i) => (
                                    <span key={i} style={bar} />
                                ))}
                            </div>
                            <h2>Put one secret behind your name.</h2>
                            <p className="lead">
                                Register a name, publish a key, and store something you would rather nobody held for
                                you.
                            </p>
                            <div className="hero-cta">
                                <HeroCta label="Dashboard" href="/dashboard" />
                                <a className="btn btn-lg" href={REPO} target="_blank" rel="noreferrer">
                                    Read the source
                                </a>
                            </div>
                        </div>
                        <div className="foot">
                            <div>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/logo.svg" alt="Rewall" width={470} height={230} />
                                <p>
                                    Permissionless secret infrastructure on ENSv2 Sepolia. Encrypted on your device,
                                    stored under your name, readable only by the keys you chose.
                                </p>
                            </div>
                            <div>
                                <h4>Read</h4>
                                <ul>
                                    <li>
                                        <a href="#works">How it works</a>
                                    </li>
                                    <li>
                                        <a href="#protocol">Protocol</a>
                                    </li>
                                    <li>
                                        <a href="#flows">Flows</a>
                                    </li>
                                    <li>
                                        <a href="#clients">Clients</a>
                                    </li>
                                    <li>
                                        <a href="#faq">FAQ</a>
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <h4>Build</h4>
                                <ul>
                                    <li>
                                        <a href="/dashboard">Dashboard</a>
                                    </li>
                                    <li>
                                        <a href={DOCS} target="_blank" rel="noreferrer">
                                            Docs
                                        </a>
                                    </li>
                                    <li>
                                        <a href={REPO} target="_blank" rel="noreferrer">
                                            Source
                                        </a>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
