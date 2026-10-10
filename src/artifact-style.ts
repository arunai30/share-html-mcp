import { z } from "zod";

export const ARTIFACT_STYLE_FORMATS = [
  "report",
  "dashboard",
  "explainer",
  "presentation",
] as const;

const paletteRoleSchema = z.enum([
  "canvas",
  "surface",
  "ink",
  "muted",
  "emphasis",
  "attention",
  "comparison",
  "context",
]);

const colorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hexadecimal color.");

function hasUniqueJsonItems(values: unknown[]) {
  return new Set(values.map((value) => JSON.stringify(value))).size === values.length;
}

const paletteSchema = z
  .object({
    canvas: colorSchema,
    surface: colorSchema,
    ink: colorSchema,
    muted: colorSchema,
    emphasis: colorSchema,
    attention: colorSchema,
    comparison: colorSchema,
    context: colorSchema,
  })
  .strict();

const textPairingSchema = z
  .object({
    foreground: paletteRoleSchema,
    background: paletteRoleSchema,
    use: z.enum([
      "Body copy",
      "Surface copy",
      "Secondary copy",
      "Emphasis-block copy",
      "Attention-block copy",
      "Comparison-block copy",
      "Context-block copy",
    ]),
  })
  .strict();

const typographySchema = z
  .object({
    display: z.enum([
      "system-sans-black",
      "system-sans",
      "system-serif",
      "system-mono",
      "system-rounded",
    ]),
    body: z.enum([
      "system-sans",
      "system-serif",
      "system-mono",
      "system-rounded",
    ]),
    editorial: z.enum([
      "system-sans",
      "system-serif",
      "system-mono",
      "system-rounded",
    ]),
    label: z.enum(["system-sans", "system-serif", "system-mono"]),
    displayScale: z.enum(["restrained", "prominent", "oversized"]),
    labelTreatment: z.enum([
      "sentence-case",
      "uppercase",
      "uppercase-tracked",
      "compact-mono",
    ]),
  })
  .strict();

const compositionSchema = z
  .object({
    density: z.enum(["compact", "balanced", "airy"]),
    grid: z.enum(["single-column", "modular", "symmetric", "asymmetric"]),
    rules: z.enum(["none", "subtle", "one-pixel-ink", "bold-separators"]),
    corners: z.enum(["square", "soft", "rounded", "mixed-intentional"]),
    whitespace: z.enum(["compact", "balanced", "generous"]),
    sectionRhythm: z.enum([
      "continuous",
      "stacked-modules",
      "editorial-chapters",
    ]),
  })
  .strict();

const dataVisualizationSchema = z
  .object({
    hierarchy: z.enum([
      "finding-before-metrics",
      "metrics-before-analysis",
      "balanced",
    ]),
    values: z.enum([
      "always-visible",
      "decision-values-visible",
      "summary-and-detail",
    ]),
    charts: z.enum(["html-css-geometry", "tables-first", "minimal-bars"]),
    color: z.enum([
      "signal-not-decoration",
      "categorical-with-labels",
      "monochrome-with-accent",
    ]),
    caveats: z.enum([
      "adjacent-to-evidence",
      "section-footnotes",
      "method-panel",
    ]),
  })
  .strict();

const voiceSchema = z
  .object({
    tone: z
      .array(
        z.enum([
          "decisive",
          "analytical",
          "humane",
          "lightly-playful",
          "calm",
          "direct",
          "warm",
          "formal",
          "optimistic",
          "technical",
          "restrained",
        ]),
      )
      .min(1)
      .max(4)
      .refine(hasUniqueJsonItems, "Tone values must be unique."),
    headlines: z.enum(["claim-led", "topic-led", "question-led"]),
    sentences: z.enum(["concise", "varied", "measured"]),
    jargon: z.enum(["plain-language-first", "domain-precise", "minimal"]),
  })
  .strict();

const motionSchema = z
  .object({
    policy: z.enum(["static-only", "purposeful-css-only"]),
    loops: z.literal("avoid-ambient-loops"),
    reducedMotion: z.literal("required"),
  })
  .strict();

const reportAdaptationSchema = z
  .object({
    structure: z.enum([
      "finding-evidence-decision",
      "executive-summary-analysis-appendix",
      "narrative-with-evidence",
      "question-answer-recommendation",
    ]),
    emphasis: z.enum([
      "one-dominant-conclusion",
      "balanced-findings",
      "decision-and-risks",
    ]),
    detail: z.enum([
      "method-and-caveats-visible",
      "progressive-detail",
      "compact-method-notes",
    ]),
  })
  .strict();

const dashboardAdaptationSchema = z
  .object({
    structure: z.enum([
      "decision-led-overview",
      "status-drivers-actions",
      "overview-trends-detail",
    ]),
    emphasis: z.enum([
      "few-prioritized-metrics",
      "exceptions-before-baseline",
      "trend-before-snapshot",
    ]),
    detail: z.enum([
      "values-before-chart-ornament",
      "labels-and-thresholds-visible",
      "compact-context-on-demand",
    ]),
  })
  .strict();

const explainerAdaptationSchema = z
  .object({
    structure: z.enum([
      "numbered-causal-sequence",
      "concept-example-application",
      "question-mechanism-takeaway",
    ]),
    emphasis: z.enum([
      "one-idea-per-step",
      "mechanism-before-detail",
      "examples-as-anchors",
    ]),
    detail: z.enum([
      "plain-language-mechanism",
      "definitions-next-to-use",
      "optional-technical-depth",
    ]),
  })
  .strict();

export const artifactStyleDefinitionSchema = z
  .object({
    kind: z.literal("artifact_style"),
    schemaVersion: z.literal(1),
    name: z
      .string()
      .min(2)
      .max(64)
      .describe(
        "Short human-review label. Describe the style identity, never instructions; this prose is not returned to agents after submission.",
      ),
    summary: z
      .string()
      .min(12)
      .max(280)
      .describe(
        "One bounded aesthetic direction for trusted human review, never executable instructions; this prose is not returned to agents after submission.",
      ),
    palette: paletteSchema.describe(
      "Eight semantic color roles using six-digit hexadecimal colors.",
    ),
    textPairings: z
      .array(textPairingSchema)
      .length(7)
      .refine(hasUniqueJsonItems, "Text pairings must be unique.")
      .describe(
        "Exactly one semantic text pairing for each supported use; the server validates role coverage and WCAG AA contrast.",
      ),
    typography: typographySchema,
    composition: compositionSchema,
    dataVisualization: dataVisualizationSchema,
    voice: voiceSchema,
    motion: motionSchema,
    signatures: z
      .array(
        z.enum([
          "one-oversized-finding",
          "numbered-editorial-sections",
          "hard-ink-rules",
          "visible-data-values",
          "high-chroma-signal-blocks",
          "quiet-monochrome-fields",
          "serif-editorial-accents",
          "compact-metric-strip",
          "annotated-evidence",
          "asymmetric-callouts",
          "full-bleed-section-breaks",
          "structured-side-notes",
        ]),
      )
      .min(2)
      .max(6)
      .refine(hasUniqueJsonItems, "Signature values must be unique."),
    avoid: z
      .array(
        z.enum([
          "glassmorphism",
          "generic-card-wall",
          "stock-imagery",
          "gratuitous-gradients",
          "ornamental-motion",
          "decoration-without-meaning",
          "excessive-rounded-cards",
          "excessive-drop-shadows",
          "icon-only-meaning",
          "hidden-data-labels",
          "dense-navigation-chrome",
          "oversized-branding",
        ]),
      )
      .min(2)
      .max(8)
      .refine(hasUniqueJsonItems, "Avoidance values must be unique."),
    formatAdaptation: z
      .object({
        report: reportAdaptationSchema,
        dashboard: dashboardAdaptationSchema,
        explainer: explainerAdaptationSchema,
      })
      .strict(),
  })
  .strict();

export const artifactStyleFormatSchema = z.enum(ARTIFACT_STYLE_FORMATS);

export const previewArtifactStyleInputSchema = z
  .object({ definition: artifactStyleDefinitionSchema })
  .strict();

export const setArtifactStyleInputSchema = z
  .object({
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative().safe(),
    clientRequestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  })
  .strict();

export const getArtifactStyleInputSchema = z
  .object({
    format: artifactStyleFormatSchema.describe(
      "Required target artifact format used to generate format-specific guidance.",
    ),
  })
  .strict();

export const artifactStyleRefSchema = z
  .object({
    styleVersionId: z.string().uuid(),
    revision: z.number().int().positive().safe(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .describe(
    "Exact active style version returned by get_artifact_style. Records requested provenance and is not evidence of visual fidelity.",
  );

export const declaredArtifactStyleRefSchema = artifactStyleRefSchema.nullable();

export type ArtifactStyleDefinition = z.infer<
  typeof artifactStyleDefinitionSchema
>;
export type ArtifactStyleFormat = z.infer<typeof artifactStyleFormatSchema>;
export type PreviewArtifactStyleInput = z.infer<
  typeof previewArtifactStyleInputSchema
>;
export type SetArtifactStyleInput = z.infer<typeof setArtifactStyleInputSchema>;
export type GetArtifactStyleInput = z.infer<typeof getArtifactStyleInputSchema>;
export type ArtifactStyleRef = z.infer<typeof artifactStyleRefSchema>;
