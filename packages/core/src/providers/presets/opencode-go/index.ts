import { standardProviderAccountConfig, type ProviderPreset } from "@ccr/core/providers/presets/types";

export const opencodeGoProviderPreset: ProviderPreset = {
  account: standardProviderAccountConfig,
  aliases: ["opencode-go", "opencode go", "go"],
  defaultModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  endpoints: [
    {
      baseUrl: "https://opencode.ai/zen/go/v1",
      label: "OpenCode Go",
      protocols: ["openai_responses", "openai_chat_completions"]
    }
  ],
  id: "opencode-go",
  name: "OpenCode Go",
  websiteUrl: "https://opencode.ai/zen/go/v1"
};
