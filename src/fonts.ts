import { z } from "zod";

export const PUBLIC_FONT_LIMITS = {
  families: 4,
  weightsPerEntry: 4,
  variants: 8,
} as const;

export const publicFontSchema = z.object({
  family: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9 ]{0,79}$/, "Use a Google Fonts family name containing ASCII letters, numbers, and spaces (up to 80 characters)."),
  weights: z.array(z.number().int().min(100).max(900).multipleOf(100))
    .min(1).max(PUBLIC_FONT_LIMITS.weightsPerEntry)
    .refine((weights) => new Set(weights).size === weights.length, "Font weights must be unique.")
    .default([400]),
  style: z.enum(["normal", "italic"]).default("normal"),
}).strict();

export const publicFontsSchema = z.array(publicFontSchema)
  .max(PUBLIC_FONT_LIMITS.families)
  .superRefine((fonts, context) => {
    const entries = new Set<string>();
    for (const [index, font] of fonts.entries()) {
      const key = `${font.family.toLowerCase()}:${font.style}`;
      if (entries.has(key)) {
        context.addIssue({ code: "custom", path: [index, "family"], message: "Each font family and style combination must be unique." });
      }
      entries.add(key);
    }
    if (fonts.reduce((total, font) => total + font.weights.length, 0) > PUBLIC_FONT_LIMITS.variants) {
      context.addIssue({ code: "custom", message: "Request at most 8 font weight/style combinations." });
    }
  })
  .describe('Google Fonts to embed, e.g. [{"family":"Inter","weights":[400,700],"style":"normal"}]. Defaults: weight 400, normal style. Up to 4 entries and 8 weight/style combinations; no URLs. Apply the family in your CSS. Omit to preserve fonts in supplied HTML; [] removes the managed font block. Cannot be used with generationId. Custom WOFF2 belongs in an embedded data:font/woff2;base64 @font-face rule in html. Font errors must be corrected; never silently remove fonts.');

export type PublicFontInput = z.input<typeof publicFontSchema>;
export type PublicFont = z.output<typeof publicFontSchema>;
export type PublicFontsInput = z.input<typeof publicFontsSchema>;
export type PublicFonts = z.output<typeof publicFontsSchema>;
