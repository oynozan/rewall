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

// Takes the user id because the session cookie is not set yet at this point
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

// Read by /error since Auth.js only ever reports the code "Configuration"
export const AUTH_WHY_COOKIE = "Test_auth_why";

// Not a cookie because Response.redirect() headers are immutable
let failure: string | null = null;
// Extra detail gathered before the throw, such as the token response's shape
let notes: string[] = [];
// Every stage the sign-in reached, so a failure says how far it got
let trail: string[] = [];

function mark(step: string): void {
    trail.push(step);
}

function noteAuthFailure(reason: string): void {
    console.error("[auth]", reason);
    // First writer wins so GitHub's own wording beats the generic rethrow
    failure ??= reason;
}

function noteAuthContext(detail: string): void {
    console.error("[auth] context:", detail);
    notes.push(detail);
}

// Recorded because an iss mismatch error prints neither side of the comparison
export function noteCallbackIssuer(value: string): void {
    noteAuthContext(`callback sent iss=${JSON.stringify(value)}`);
}

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

// One GitHub API call with the error checks the bundled provider omits
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
    trustHost: true, // Self-hosted Auth.js v5 throws UntrustedHost without this
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
        GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            authorization: { params: { scope: "read:user user:email" } },
            issuer: "https://github.com", // Without this, @auth/core rejects GitHub's iss callback parameter
            // GitHub answers a refused token exchange with HTTP 200
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

                // Record the shape only
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
            // Bundled userinfo request can crash and it skips customFetch
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
    // The real reason exists only here, nested under cause.err
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

            // Auth.js rewrites anything thrown here into a bare AccessDenied
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

            // Recorded for the same reason as in signIn
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

            // Every sign-in path passes through here with the Mongo ID
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