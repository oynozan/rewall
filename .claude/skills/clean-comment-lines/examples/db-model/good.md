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
        title: { type: String, required: true, trim: true, maxlength: 200 },
        slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
        previousSlugs: { type: [String], default: [] }, // a renamed post redirects instead of 404ing
        metaDescription: { type: String, required: true, trim: true, maxlength: 200 },
        thumbnailUrl: { type: String },
        thumbnailAlt: { type: String, default: "" },
        thumbnailWidth: { type: Number },
        thumbnailHeight: { type: Number },
        contentHtml: { type: String, required: true },
        tags: { type: [String], default: [], index: true }, // Must match the tool catalog's tag vocabulary for internal linking
        status: {
            type: String,
            enum: ["draft", "published"],
            default: "draft",
            required: true,
        },
        publishedAt: { type: Date, default: null },
        authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        authorName: { type: String, required: true },
        readingTimeMinutes: { type: Number, default: 1 },
    },
    { timestamps: true },
);

// The public list, the sitemap and the feed all run this query
postSchema.index({ status: 1, publishedAt: -1 });
postSchema.index({ previousSlugs: 1 });

const Post =
    (mongoose.models.Post as mongoose.Model<IPost>) || mongoose.model<IPost>("Post", postSchema);

export default Post;