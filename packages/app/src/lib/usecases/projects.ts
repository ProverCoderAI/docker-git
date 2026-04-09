/* jscpd:ignore-start */
export { applyAllDockerGitProjects } from "./projects-apply-all.js"
export {
  buildSshCommand,
  getContainerIpIfInsideContainer,
  loadProjectItem,
  loadProjectStatus,
  loadProjectSummary,
  type ProjectItem,
  type ProjectLoadError,
  type ProjectStatus
} from "./projects-core.js"
export { deleteDockerGitProject } from "./projects-delete.js"
export { downAllDockerGitProjects } from "./projects-down.js"
export { listProjectItems, listProjects, listProjectSummaries, listRunningProjectItems } from "./projects-list.js"
export {
  connectProjectSsh,
  connectProjectSshWithUp,
  listProjectStatus,
  type PreparedProjectSsh,
  prepareProjectSsh,
  prepareProjectSshWithUp,
  probeProjectSshReady,
  waitForProjectSshReady
} from "./projects-ssh.js"
export { runDockerComposeUpWithPortCheck } from "./projects-up.js"
/* jscpd:ignore-end */
