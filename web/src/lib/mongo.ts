import { MongoClient, type Collection } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";

export type Provisioned = {
    resolver?: string;
    registry?: string;
    namespaceRegistry?: string;
    commitSecret?: `0x${string}`;
    committedAt?: number;
    registeredAt?: number;
    handedOverAt?: number;
};

// One document per wallet, keyed by the lowercased address so a checksum variant cannot claim a second drip
export type Account = {
    _id: string;
    firstSeen: number;
    // pending marks a leg claimed but not yet confirmed, which stops two requests paying it twice
    dripped?: { hash: string; wei: string; at: number; pending?: boolean };
    funded?: { hash: string; units: string; at: number; pending?: boolean };
    name?: string;
    provisioned?: Provisioned;
    completedAt?: number;
};

// Next reloads modules on every edit in dev, and each reload would otherwise open its own pool
const cached = globalThis as typeof globalThis & { rewallMongo?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
    // A rejected promise is neither null nor undefined, so caching one would fail every later call forever
    cached.rewallMongo ??= new MongoClient(uri, { serverSelectionTimeoutMS: 3000 }).connect().catch((failure) => {
        cached.rewallMongo = undefined;
        throw failure;
    });
    return cached.rewallMongo;
}

export async function accounts(): Promise<Collection<Account>> {
    return (await client()).db("rewall").collection<Account>("accounts");
}

export async function accountFor(address: string): Promise<Account | null> {
    return (await accounts()).findOne({ _id: address.toLowerCase() });
}

// Upserted rather than inserted so a wallet that connects twice keeps its original firstSeen
export async function seeAccount(address: string): Promise<Account> {
    const id = address.toLowerCase();
    const collection = await accounts();
    await collection.updateOne(
        { _id: id },
        { $setOnInsert: { firstSeen: Math.floor(Date.now() / 1000) } },
        { upsert: true },
    );
    return (await collection.findOne({ _id: id }))!;
}

export async function updateAccount(address: string, fields: Partial<Omit<Account, "_id">>): Promise<void> {
    await (await accounts()).updateOne({ _id: address.toLowerCase() }, { $set: fields });
}

/* Claims, so a leg is reserved in the ledger before any money moves */

// Only one request can turn an absent leg into a pending one, which is what serialises a parallel drip
export async function claimDrip(address: string, wei: string): Promise<boolean> {
    const result = await (
        await accounts()
    ).updateOne(
        { _id: address.toLowerCase(), dripped: { $exists: false } },
        { $set: { dripped: { hash: "", wei, at: Math.floor(Date.now() / 1000), pending: true } } },
    );
    return result.modifiedCount === 1;
}

export async function releaseDrip(address: string): Promise<void> {
    await (await accounts()).updateOne({ _id: address.toLowerCase() }, { $unset: { dripped: "" } });
}

export async function claimFunding(address: string, units: string): Promise<boolean> {
    const result = await (
        await accounts()
    ).updateOne(
        { _id: address.toLowerCase(), funded: { $exists: false } },
        { $set: { funded: { hash: "", units, at: Math.floor(Date.now() / 1000), pending: true } } },
    );
    return result.modifiedCount === 1;
}

export async function releaseFunding(address: string): Promise<void> {
    await (await accounts()).updateOne({ _id: address.toLowerCase() }, { $unset: { funded: "" } });
}

// The cap is read back off the ledger rather than tracked in a counter, so a crash cannot lose spend
export async function drippedTotal(): Promise<bigint> {
    const rows = await (
        await accounts()
    )
        .find({ dripped: { $exists: true } }, { projection: { dripped: 1 } })
        .toArray();
    return rows.reduce((sum, row) => sum + BigInt(row.dripped?.wei ?? 0), BigInt(0));
}

// A structural twin of drippedTotal, because folding them together needs casts past Collection<Account>
export async function fundedTotal(): Promise<bigint> {
    const rows = await (await accounts()).find({ funded: { $exists: true } }, { projection: { funded: 1 } }).toArray();
    return rows.reduce((sum, row) => sum + BigInt(row.funded?.units ?? 0), BigInt(0));
}
