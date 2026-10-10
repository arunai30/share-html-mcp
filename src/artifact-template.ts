import { z } from "zod";

export const previewTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  designNotes: z.string().trim().max(2_000).default(""),
  format: z.literal("presentation").default("presentation"),
  html: z.string().min(1).max(200_000),
  aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
}).strict();

export const listTemplatesInputSchema = z.object({
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
}).strict();

export const getTemplateInputSchema = z.object({
  templateId: z.string().uuid(),
  includeHtml: z.boolean().default(false),
}).strict();

export const saveTemplateInputSchema = z.object({
  draftId: z.string().uuid(),
}).strict();

export type PreviewTemplateInput = z.input<typeof previewTemplateInputSchema>;
export type ListTemplatesInput = z.input<typeof listTemplatesInputSchema>;
export type GetTemplateInput = z.input<typeof getTemplateInputSchema>;
export type SaveTemplateInput = z.input<typeof saveTemplateInputSchema>;
