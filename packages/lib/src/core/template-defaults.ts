// CHANGE: re-export container template defaults from the dedicated package (issue #412)
// WHY: template defaults now live in @prover-coder-ai/docker-git-container; this shim keeps
//      "../core/template-defaults.js" import paths working for the backend after the extraction.
// REF: issue-412
// PURITY: CORE
export {
  defaultCpuLimit,
  defaultDockerNetworkMode,
  defaultDockerSharedNetworkName,
  defaultPlaywrightCpuLimit,
  defaultPlaywrightRamLimit,
  defaultRamLimit,
  defaultTemplateConfig,
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName
} from "@prover-coder-ai/docker-git-container"
