import type {
  CursorModelFamily,
  CursorModelVariant,
} from "../src/shared/cursor-model-types";

const VARIANT_SUFFIXES = [
  "extra-high",
  "thinking",
  "xhigh",
  "minimal",
  "medium",
  "ultra",
  "none",
  "low",
  "high",
  "max",
  "fast",
] as const;

const VARIANT_LABELS: Record<(typeof VARIANT_SUFFIXES)[number], string> = {
  "extra-high": "Extra high",
  thinking: "Thinking",
  xhigh: "Extra high",
  minimal: "Minimal",
  medium: "Medium",
  ultra: "Ultra",
  none: "None",
  low: "Low",
  high: "High",
  max: "Max",
  fast: "Fast",
};

const ACRONYMS = new Set(["gpt", "ai", "api", "glm"]);

const EFFORT_RANK: Record<string, number> = {
  ultra: 0,
  max: 1,
  "extra-high": 2,
  xhigh: 2,
  high: 3,
  medium: 4,
  low: 5,
  none: 6,
  minimal: 7,
};

export function splitCursorModelId(value: string): {
  familyId: string;
  variantTokens: string[];
} {
  let rest = value;
  const tokens: string[] = [];

  for (;;) {
    const suffix = VARIANT_SUFFIXES.find(
      (candidate) => rest === candidate || rest.endsWith(`-${candidate}`),
    );
    if (!suffix) {
      break;
    }
    tokens.unshift(suffix);
    rest = rest === suffix ? "" : rest.slice(0, -(suffix.length + 1));
  }

  return {
    familyId: rest || value,
    variantTokens: tokens,
  };
}

export function formatCursorFamilyLabel(familyId: string): string {
  return collapseNumericVersionParts(familyId.split("-"))
    .map((part) => {
      if (ACRONYMS.has(part)) {
        return part.toUpperCase();
      }
      if (part.length === 0 || /^[0-9]/.test(part)) {
        return part;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function formatCursorVariantLabel(variantTokens: string[]): string {
  if (variantTokens.length === 0) {
    return "Default";
  }
  return variantTokens.map(labelForVariantToken).join(" · ");
}

function labelForVariantToken(token: string): string {
  for (const suffix of VARIANT_SUFFIXES) {
    if (suffix === token) {
      return VARIANT_LABELS[suffix];
    }
  }
  return token;
}

export function formatCursorDisplayLabel(
  familyLabel: string,
  variantTokens: string[],
): string {
  const variantLabel = formatCursorVariantLabel(variantTokens);
  return variantLabel === "Default"
    ? familyLabel
    : `${familyLabel} · ${variantLabel}`;
}

export function groupCursorModels(
  models: readonly string[],
): CursorModelFamily[] {
  const families: CursorModelFamily[] = [];
  const familyIndex = new Map<string, CursorModelFamily>();

  for (const model of models) {
    const { familyId, variantTokens } = splitCursorModelId(model);
    const familyLabel = formatCursorFamilyLabel(familyId);
    const variant: CursorModelVariant = {
      value: model,
      variantLabel: formatCursorVariantLabel(variantTokens),
      displayLabel: formatCursorDisplayLabel(familyLabel, variantTokens),
    };

    const existing = familyIndex.get(familyId);
    if (existing) {
      existing.variants.push(variant);
      continue;
    }

    const family: CursorModelFamily = {
      id: familyId,
      label: familyLabel,
      variants: [variant],
    };
    familyIndex.set(familyId, family);
    families.push(family);
  }

  for (const family of families) {
    family.variants.sort(compareCursorVariants);
  }

  return families;
}

function collapseNumericVersionParts(parts: string[]): string[] {
  const collapsed: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (part !== undefined && /^\d+$/.test(part)) {
      const numbers: string[] = [];
      while (index < parts.length) {
        const next = parts[index];
        if (next === undefined || !/^\d+$/.test(next)) {
          break;
        }
        numbers.push(next);
        index += 1;
      }
      collapsed.push(numbers.join("."));
      continue;
    }
    if (part !== undefined) {
      collapsed.push(part);
    }
    index += 1;
  }
  return collapsed;
}

function compareCursorVariants(
  left: CursorModelVariant,
  right: CursorModelVariant,
): number {
  const leftSplit = splitCursorModelId(left.value);
  const rightSplit = splitCursorModelId(right.value);
  const thinkingDelta =
    Number(leftSplit.variantTokens.includes("thinking")) -
    Number(rightSplit.variantTokens.includes("thinking"));
  if (thinkingDelta !== 0) {
    return thinkingDelta;
  }
  const effortDelta =
    variantEffortRank(leftSplit.variantTokens) -
    variantEffortRank(rightSplit.variantTokens);
  if (effortDelta !== 0) {
    return effortDelta;
  }
  return (
    Number(leftSplit.variantTokens.includes("fast")) -
    Number(rightSplit.variantTokens.includes("fast"))
  );
}

function variantEffortRank(tokens: string[]): number {
  const effort = tokens.find((token) => token in EFFORT_RANK);
  return effort ? (EFFORT_RANK[effort] ?? 8) : -1;
}
