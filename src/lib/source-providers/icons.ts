import type { ComponentType } from "react";
import { SiHuggingface } from "react-icons/si";

import type { SourceProviderKind } from "./kinds";

export const SOURCE_PROVIDER_ICONS: Record<
  SourceProviderKind,
  ComponentType<{ className?: string }>
> = {
  huggingface: SiHuggingface,
};
