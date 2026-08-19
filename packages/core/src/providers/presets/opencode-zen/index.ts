import { standardProviderAccountConfig, type ProviderPreset } from "@ccr/core/providers/presets/types";

export const opencodeZenProviderPreset: ProviderPreset = {
  account: standardProviderAccountConfig,
  aliases: ["opencode-zen", "opencode zen", "zen"],
  defaultModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  endpoints: [
    {
      baseUrl: "https://opencode.ai/zen/v1",
      label: "OpenCode Zen",
      protocols: ["openai_responses", "openai_chat_completions"]
    }
  ],
  id: "opencode-zen",
  name: "OpenCode Zen",
  websiteUrl: "https://opencode.ai/zen/v1"
};
