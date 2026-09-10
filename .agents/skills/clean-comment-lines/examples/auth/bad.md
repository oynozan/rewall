import NextAuth, { customFetch } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "@/db/mongoose";
import User from "@/db/models/user";
import Scan from "@/db/models/scan";
import { peekAnonId } from "@/lib/anon-id";

/**
 * Move this browser's anonymous scans onto the account that just signed in.
 *
 * Lives at the sign-in choke point, not at a call site: this used to run only
 * inside SignupModal's credentials path, so a visitor who converted with Google
 * or GitHub, offered right under that same form, or who dismissed the modal
 * and signed up at /register never claimed anything, and their scan silently
 * expired on the 7-day TTL.
 *
 * Takes the resolved Mongo id rather than reading the session: the session
 * cookie is not set yet at this point in the flow, so `auth()` here would find
 * nothing. The anon id still comes from the cookie jar, never from an argument
 *, it names a socket.io room server-side (see lib/anon-id).
 *
 * Idempotent by filter, and it never throws: a failed claim must not fail a
 * sign-in that otherwise worked. Worst case the rows expire unclaimed.
 */
async function claimAnonymousScans(userId: string): Promise<void> {
    try {
        const anonId = await peekAnonId();
        if (!anonId) return;

        await connectDB();
        await Scan.updateMany(
            { anonId, userId: { $exists: false } },
            { $set: { userId: new mongoose.Types.ObjectId(userId) } },
        );
    } catch (err) {
        console.error("[Auth] Anonymous scan claim failed:", err);
    }
}

/** Read by /error, because Auth.js only ever reports the code "Configuration". */
export const AUTH_WHY_COOKIE = "Test_auth_why";

/**
 * The reason for the current request's failure, drained by the route handler.
 *
 * A module variable rather than cookies(): the failing response is built by
 * Response.redirect(), whose headers are immutable, and the Next cookie store is
 * not reliably applied from inside a synchronous Auth.js logger callback. The
 * route wrapper clones the response and attaches this instead.
 */
let failure: string | null = null;
/** Extra detail gathered before the throw, e.g. the token response's shape. */
let notes: string[] = [];
/** Every stage the sign-in reached, so a failure says how far it got. */
let trail: string[] = [];

function mark(step: string): void {
    trail.push(step);
}

function noteAuthFailure(reason: string): void {
    console.error("[auth]", reason);
    // First writer wins: GitHub's own wording beats the generic rethrow above it.
    failure ??= reason;
}

function noteAuthContext(detail: string): void {
    console.error("[auth] context:", detail);
    notes.push(detail);
}

/**
 * The provider's RFC 9207 issuer, recorded verbatim by the route handler.
 *
 * oauth4webapi compares this to `as.issuer` with ===, so a trailing slash or a
 * different host fails and there is no way to know the real value from the error
 * message: it prints neither side. Recording it is the only way to see it.
 */
export function noteCallbackIssuer(value: string): void {
    noteAuthContext(`callback sent iss=${JSON.stringify(value)}`);
}

/** Returns and clears whatever this request recorded. */
export function takeAuthFailure(): string | null {
    const why = failure;
    const detail = notes.join("; ");
    const path = trail.join(" > ");
    failure = null;
    notes = [];
    trail = [];
    if (!why) return null;
    return [why, detail, path && `reached: ${path}`].filter(Boolean).join(" | ");
}

/** One GitHub API call, with the error checks the bundled provider omits. */
async function githubApi(path: string, accessToken: string): Promise<Record<string, unknown>> {
    const url = `https://api.github.com${path}`;
    let res: Response;
    try {
        res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "Test",
            },
        });
    } catch (err) {
        noteAuthFailure(`github ${path} was unreachable: ${(err as Error).message}`);
        throw err;
    }

    const body = await res.text();
    if (!res.ok) {
        noteAuthFailure(`github ${path} returned ${res.status}: ${body.slice(0, 200)}`);
        throw new Error(`github ${path} returned ${res.status}`);
    }
    try {
        return JSON.parse(body);
    } catch {
        noteAuthFailure(`github ${path} returned non-JSON: ${body.slice(0, 150)}`);
        throw new Error(`github ${path} returned a body that is not JSON`);
    }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    // Trust the host header. Required by Auth.js v5 for self-hosted deployments
    // (and any run where NODE_ENV !== "development"); without it every auth call
    // throws UntrustedHost. Safe here, this app controls its own host.
    trustHost: true,
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
        GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            authorization: { params: { scope: "read:user user:email" } },
            /**
             * GitHub returns `iss=https://github.com` on the callback (RFC 9207).
             * oauth4webapi compares it against `as.issuer`, which @auth/core
             * defaults to the placeholder "https://authjs.dev" when a provider
             * declares none (oauth/callback.js:49), so the comparison fails and
             * every GitHub sign-in dies with `unexpected "iss" response parameter
             * value`. Naming the real issuer is the whole fix.
             *
             * Safe against OIDC discovery: that branch only runs when the token
             * AND userinfo hosts are both authjs.dev, and `wellKnown` is assigned
             * but never read anywhere in @auth/core.
             */
            issuer: "https://github.com",
            /**
             * GitHub answers a REFUSED token exchange with HTTP 200 and an error
             * body, and oauth4webapi only reads an OAuth error body on a 4xx
             * (build/index.js:916), so every cause arrives as the identical
             * `"access_token" property must be a string`. A wrong secret and a
             * reused code are indistinguishable. This reads GitHub's own reason
             * out of the body before it is thrown away.
             */
            async [customFetch](...args: Parameters<typeof fetch>) {
                const res = await fetch(...args);
                const input = args[0];
                const href = input instanceof Request ? input.url : String(input);
                if (!href.includes("access_token")) return res;

                const body = await res.clone().text();
                if (!body.includes('"access_token"')) {
                    mark("token:refused");
                    noteAuthFailure(`github refused the token exchange: ${body.slice(0, 250)}`);
                    return res;
                }
                mark("token:ok");

                // Succeeded. Record the SHAPE only, never the token: if the
                // request still fails later, this says whether the exchange was
                // even the problem, and oauth4webapi rejects a response whose
                // token_type or scope is wrong just as loudly as a missing token.
                try {
                    const json = JSON.parse(body) as Record<string, unknown>;
                    noteAuthContext(
                        `token ok, status ${res.status}, keys [${Object.keys(json).join(",")}], ` +
                            `token_type=${String(json.token_type)}, scope=${String(json.scope)}`,
                    );
                } catch {
                    noteAuthContext(`token response was not JSON, status ${res.status}`);
                }
                return res;
            },
            /**
             * Replaces the bundled userinfo request, which has three unguarded
             * crash sites (providers/github.js:81-99): it calls res.json() with no
             * res.ok check, and it indexes emails[0] with no length check. Those
             * throw OUTSIDE getUserAndAccount's try (oauth/callback.js:189 vs 217),
             * so each one becomes a bare CallbackRouteError. They also use global
             * fetch, so customFetch above never sees them.
             */
            userinfo: {
                url: "https://api.github.com/user",
                async request({ tokens }: { tokens: { access_token?: string } }) {
                    const token = tokens.access_token ?? "";
                    mark("userinfo:start");
                    const profile = await githubApi("/user", token);
                    mark("userinfo:ok");

                    if (!profile.email) {
                        mark("email:private");
                        const emails = await githubApi("/user/emails", token).catch(() => null);
                        const list = Array.isArray(emails) ? (emails as { primary?: boolean; email?: string }[]) : [];
                        const pick = list.find(e => e.primary) ?? list[0];
                        if (pick?.email) profile.email = pick.email;
                        else noteAuthFailure("github returned no usable email for this account");
                    }
                    return profile;
                },
            },
        }),
        Credentials({
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                await connectDB();

                const user = await User.findOne({
                    email: (credentials.email as string).toLowerCase(),
                }).select("+password");

                if (!user || !user.password) {
                    return null;
                }

                const isValid = await bcrypt.compare(credentials.password as string, user.password);

                if (!isValid) {
                    return null;
                }

                return {
                    id: user._id.toString(),
                    name: user.name,
                    email: user.email,
                };
            },
        }),
    ],
    /**
     * Auth.js reports almost every server-side failure to the browser as the
     * single code `Configuration`, whatever actually happened: a missing PKCE
     * cookie, a token exchange the provider rejected and a callback that threw
     * all redirect to the identical `/error?error=Configuration`. The real
     * reason exists only here, and Auth.js nests it under `cause.err`, so the
     * chain is unwrapped onto one greppable line.
     */
    logger: {
        error(error: Error) {
            const chain: string[] = [];
            let cur: unknown = error;
            while (cur instanceof Error && chain.length < 5) {
                const type = (cur as { type?: string }).type;
                chain.push(`${type ?? cur.name}: ${cur.message}`);
                const cause = cur.cause;
                cur =
                    cause && typeof cause === "object" && "err" in cause
                        ? (cause as { err: unknown }).err
                        : cause;
            }
            noteAuthFailure(chain.join(" <- "));
            if (error.stack) console.error(error.stack);
        },
    },
    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60,
    },
    pages: {
        signIn: "/login",
        error: "/error",
    },
    callbacks: {
        async signIn({ user, account }) {
            if (account?.provider !== "google" && account?.provider !== "github") return true;

            mark("signin:start");
            if (!user.email) {
                noteAuthFailure(`${account.provider} gave no email address, so the account cannot be matched`);
                return false;
            }

            // Auth.js rewrites anything thrown here into a bare AccessDenied and
            // discards the cause (callback/index.js:402), so it is recorded first.
            try {
                await connectDB();
                mark("signin:db");

                const email = user.email.toLowerCase();
                const existingUser = await User.findOne({ email });

                if (existingUser) {
                    if (user.name) existingUser.name = user.name;
                    if (user.image) existingUser.image = user.image;
                    await existingUser.save();
                    mark("signin:updated");
                } else {
                    await User.create({
                        name: user.name ?? email,
                        email,
                        image: user.image ?? undefined,
                        provider: account.provider,
                        emailVerified: new Date(),
                    });
                    mark("signin:created");
                }
            } catch (err) {
                noteAuthFailure(`signIn callback threw: ${(err as Error).name}: ${(err as Error).message}`);
                throw err;
            }

            return true;
        },
        async jwt({ token, user, account }) {
            if (user && account?.provider === "credentials") {
                token.id = user.id;
                token.name = user.name;
                token.email = user.email;
            }

            // The ONLY app callback whose throws become CallbackRouteError rather
            // than AccessDenied, because it runs inside the outer try
            // (callback/index.js:179). Recorded for the same reason as signIn.
            if (user && (account?.provider === "google" || account?.provider === "github")) {
                mark("jwt:start");
                try {
                    await connectDB();
                    const dbUser = await User.findOne({
                        email: user.email?.toLowerCase(),
                    });
                    mark(dbUser ? "jwt:found" : "jwt:missing");
                    if (dbUser) {
                        token.id = dbUser._id.toString();
                        token.name = dbUser.name;
                        token.email = dbUser.email;
                        token.picture = dbUser.image;
                    }
                } catch (err) {
                    noteAuthFailure(`jwt callback threw: ${(err as Error).name}: ${(err as Error).message}`);
                    throw err;
                }
            }

            // The one place EVERY sign-in path passes through, which is why the
            // claim lives here and not in a component: credentials (the signup
            // modal and /login) and both OAuth providers all reach this callback
            // with `user` set, and it is the only hook that has already resolved
            // the Mongo id for both, `events.signIn` hands back the provider's
            // account id for OAuth, not ours.
            //
            // `user` is set on the initial sign-in only, never on a session read
            // or the modal's `update()`, so this runs exactly once per sign-in.
            // Cookies are readable in both hosts: the credentials flow runs this
            // inside a Server Function (next-auth/lib/actions.js calls Auth()
            // in-process) and OAuth inside the /api/auth Route Handler, and the
            // anon cookie is SameSite=Lax so it rides the top-level GET back
            // from the provider.
            if (user && typeof token.id === "string") await claimAnonymousScans(token.id);

            if (user) mark("jwt:ok");
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                session.user.name = token.name as string;
                session.user.email = token.email as string;
            }
            return session;
        },
    },
});
