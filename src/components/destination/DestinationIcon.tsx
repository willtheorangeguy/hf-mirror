import { SiForgejo, SiGitea } from "react-icons/si";
import { DESTINATION_PROVIDER_LABELS, normalizeDestinationProviderKind, type DestinationProviderKind } from "@/lib/destination-kinds";

const icons: Record<DestinationProviderKind, React.ComponentType<{ className?: string }>> = {
  gitea: SiGitea,
  forgejo: SiForgejo,
};

/** Brand icon for the host mirrors are created on. */
export function DestinationIcon({
  provider,
  className,
}: {
  provider: DestinationProviderKind | string | null | undefined;
  className?: string;
}) {
  const Icon = icons[normalizeDestinationProviderKind(provider)] ?? SiGitea;
  return <Icon className={className} />;
}

/** Kind, label and transport for a configured destination. */
export function destinationInfo(config: { provider?: string | null } | null | undefined): {
  provider: DestinationProviderKind;
  label: string;
  canTransfer: boolean;
} {
  const provider = normalizeDestinationProviderKind(config?.provider);
  return { provider, label: DESTINATION_PROVIDER_LABELS[provider], canTransfer: true };
}
