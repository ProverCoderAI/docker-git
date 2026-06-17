// CHANGE: re-export the container-definition rendering surface from its dedicated package (issue #412)
// WHY: planFiles / render* and the FileSpec contract now live in @prover-coder-ai/docker-git-container.
//      This shim keeps "../core/templates.js" import paths working for the backend after the extraction.
// REF: issue-412
// PURITY: CORE
export * from "@prover-coder-ai/docker-git-container"
