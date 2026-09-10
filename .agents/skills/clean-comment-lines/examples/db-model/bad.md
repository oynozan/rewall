import mongoose, { Schema, type Document } from "mongoose";

export type PostStatus = "draft" | "published";

export interface IPost extends Document {
    title: string;
    slug: string;
    previousSlugs: string[];
    metaDescription: string;
    thumbnailUrl?: string;
    thumbnailAlt: string;
    thumbnailWidth?: number;
    thumbnailHeight?: number;
    contentHtml: string;
    tags: string[];
    status: PostStatus;
    publishedAt?: Date | null;
    authorId: mongoose.Types.ObjectId;
    authorName: string;
    readingTimeMinutes: number;
    createdAt: Date;
    updatedAt: Date;
}

const postSchema = new Schema<IPost>(
    {
        // Denormalized out of contentHtml so the index page, sitemap and feed
        // never have to load or re-parse a full article body.
        title: { type: String, required: true, trim: true, maxlength: 200 },
        slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
        // Old slugs, so a rename 308s instead of 404ing. A blog that breaks its
        // own backlinks is not defensible for a product that sells SEO auditing.
        previousSlugs: { type: [String], default: [] },
        metaDescription: { type: String, required: true, trim: true, maxlength: 200 },
        thumbnailUrl: { type: String },
        thumbnailAlt: { type: String, default: "" },
        // Explicit dimensions prevent CLS on what is always the LCP element.
        thumbnailWidth: { type: Number },
        thumbnailHeight: { type: Number },
        contentHtml: { type: String, required: true },
        // Shared vocabulary with the tool catalog, the only signal the internal
        // linking graph (blog↔tools, blog↔blog) has to work with.
        tags: { type: [String], default: [], index: true },
        status: {
            type: String,
            enum: ["draft", "published"],
            default: "draft",
            required: true,
        },
        // Set ONCE on first publish and never rewritten: unpublishing and
        // republishing must not reshuffle the feed order.
        publishedAt: { type: Date, default: null },
        authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        // Denormalized: a populate() per render for a value that never changes is
        // a wasted round trip, and a deleted account shouldn't blank the byline.
        authorName: { type: String, required: true },
        // Pure function of contentHtml, computed on write instead of stripping
        // tags on every request.
        readingTimeMinutes: { type: Number, default: 1 },
    },
    { timestamps: true },
);

// The public list, the sitemap and the feed all run this exact query.
postSchema.index({ status: 1, publishedAt: -1 });
// Old-slug redirect lookup.
postSchema.index({ previousSlugs: 1 });

const Post =
    (mongoose.models.Post as mongoose.Model<IPost>) || mongoose.model<IPost>("Post", postSchema);

export default Post;
