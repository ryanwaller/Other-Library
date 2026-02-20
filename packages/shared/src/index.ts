import { z } from "zod";

export const ProfileVisibilitySchema = z.enum(["followers_only", "public"]);
export type ProfileVisibility = z.infer<typeof ProfileVisibilitySchema>;

export const UserBookVisibilitySchema = z.enum(["inherit", "followers_only", "public"]);
export type UserBookVisibility = z.infer<typeof UserBookVisibilitySchema>;

export const FollowStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type FollowStatus = z.infer<typeof FollowStatusSchema>;

export const EditionSchema = z.object({
  id: z.number().int(),
  isbn13: z.string().nullable().optional(),
  isbn10: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  authors: z.array(z.string()).default([]),
  publisher: z.string().nullable().optional(),
  publish_date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  subjects: z.array(z.string()).default([]),
  cover_url: z.string().nullable().optional()
});
export type Edition = z.infer<typeof EditionSchema>;

export const UserBookSchema = z.object({
  id: z.number().int(),
  owner_id: z.string(),
  edition_id: z.number().int().nullable().optional(),
  title_override: z.string().nullable().optional(),
  authors_override: z.array(z.string()).nullable().optional(),
  visibility: UserBookVisibilitySchema,
  status: z.enum(["owned", "loaned", "selling", "trading"]),
  location: z.string().nullable().optional(),
  shelf: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string()
});
export type UserBook = z.infer<typeof UserBookSchema>;

