
import { DatabaseBackup, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { HFSourceConfig, MirrorOptions, AdvancedOptions, DestinationProvider } from "@/types/config";
import { SettingsCard, CardSection, SwitchRow } from "./settings-ui";

interface HFMirrorSettingsProps {
  sourceConfig: HFSourceConfig;
  mirrorOptions: MirrorOptions;
  destinationProvider?: DestinationProvider;
  advancedOptions: AdvancedOptions;
  onSourceConfigChange: (config: HFSourceConfig) => void;
  onMirrorOptionsChange: (options: MirrorOptions) => void;
  onAdvancedOptionsChange: (options: AdvancedOptions) => void;
  part?: "selection" | "content" | "both";
  sources?: ReadonlyArray<{ provider: string }>;
}

export function HFMirrorSettings({ sourceConfig, mirrorOptions, advancedOptions,
  onSourceConfigChange, onMirrorOptionsChange, onAdvancedOptionsChange, part = "both" }: HFMirrorSettingsProps) {
  const changeSource = (patch: Partial<HFSourceConfig>) => onSourceConfigChange({ ...sourceConfig, ...patch });
  const changeContent = (patch: Partial<MirrorOptions>) => onMirrorOptionsChange({ ...mirrorOptions, ...patch });
  const types = sourceConfig.repoTypes ?? ["model", "dataset", "space"];
  return <div className="space-y-6">
    {part !== "content" && <SettingsCard icon={Filter} title="Hugging Face discovery">
      <CardSection>
        <div className="space-y-3">
          <Label>Repository types</Label>
          <div className="flex flex-wrap gap-5">
            {(["model", "dataset", "space"] as const).map(type => <label key={type} className="flex items-center gap-2 capitalize">
              <Checkbox aria-label={`Discover ${type}s`} checked={types.includes(type)} onCheckedChange={checked => changeSource({ repoTypes: checked ? [...types, type] : types.filter(t => t !== type) })} />{type}s
            </label>)}
          </div>
        </div>
        <SwitchRow label="Private repositories" description="Include private repositories your read token can access" checked={sourceConfig.privateRepositories} onCheckedChange={checked => changeSource({ privateRepositories: checked })} />
        <SwitchRow label="Liked repositories" description="Discover models, datasets, and Spaces liked by your HF account" checked={sourceConfig.mirrorStarred} onCheckedChange={checked => changeSource({ mirrorStarred: checked })} />
        {sourceConfig.mirrorStarred && <SwitchRow label="Automatically mirror new likes" description="When off, new likes are imported for manual selection" checked={advancedOptions.autoMirrorStarred ?? false} onCheckedChange={checked => onAdvancedOptionsChange({ ...advancedOptions, autoMirrorStarred: checked })} />}
        <div className="space-y-2">
          <Label htmlFor="hf-organizations">Organizations (comma separated)</Label>
          <Input id="hf-organizations" defaultValue={(sourceConfig.includeOrganizations ?? []).join(", ")} onBlur={event => changeSource({ includeOrganizations: event.target.value.split(",").map(v => v.trim()).filter(Boolean) })} placeholder="huggingface, bigscience" />
          <p className="text-xs text-muted-foreground">Leave empty to discover organizations associated with your token. Public organizations also work without a token.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="hf-collections">Collections (one slug per line)</Label>
          <textarea id="hf-collections" className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" defaultValue={(sourceConfig.collections ?? []).join("\n")} onBlur={event => changeSource({ collections: event.target.value.split(/\n/).map(v => v.trim().replace(/^https:\/\/huggingface\.co\/collections\//, "")).filter(Boolean) })} placeholder="owner/collection-name-id" />
          <p className="text-xs text-muted-foreground">Model, dataset, and Space entries are imported. Other entry types are skipped and logged.</p>
        </div>
      </CardSection>
    </SettingsCard>}
    {part !== "selection" && <SettingsCard icon={DatabaseBackup} title="Backup content">
      <CardSection>
        <p className="text-sm text-muted-foreground">Git history, branches, tags, cards, and available PR refs are always preserved.</p>
        <SwitchRow label="Complete large-file backup" description="Copy all reachable historical weights and dataset files through HF's LFS/Xet bridge. Turning this off creates a Git-only backup." checked={mirrorOptions.mirrorLFS} onCheckedChange={checked => changeContent({ mirrorLFS: checked })} />
        <SwitchRow label="Community metadata" description="Archive HF metadata and mirror conversations to Gitea issues" checked={mirrorOptions.mirrorMetadata} onCheckedChange={checked => changeContent({ mirrorMetadata: checked })} />
        {mirrorOptions.mirrorMetadata && <div className="space-y-3 border-l-2 border-primary/30 pl-4">
          <SwitchRow label="Discussions" description="Preserve comments, source attribution, and open/closed state" checked={mirrorOptions.metadataComponents.issues} onCheckedChange={checked => changeContent({ metadataComponents: { ...mirrorOptions.metadataComponents, issues: checked } })} />
          <SwitchRow label="Pull request conversations" description="Copy PR conversations as issues; archive available Git refs separately" checked={mirrorOptions.metadataComponents.pullRequests} onCheckedChange={checked => changeContent({ metadataComponents: { ...mirrorOptions.metadataComponents, pullRequests: checked } })} />
        </div>}
        <p className="text-xs text-muted-foreground">Private and gated sources always have private destinations. Spaces are backed up as repositories; runtime secrets and untracked volumes are excluded.</p>
      </CardSection>
    </SettingsCard>}
  </div>;
}
