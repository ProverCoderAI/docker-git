/* jscpd:ignore-start */
import type { GpuMode } from "./domain.js"

const nvidiaFailureMarkers = [
  "nvidia-container-cli",
  "libnvidia-ml.so.1",
  "could not select device driver"
]

// CHANGE: classify Docker/NVIDIA runtime failures from compose output.
// WHY: GPU device requests fail before the container entrypoint can run, so recovery must happen outside Docker.
// QUOTE(ТЗ): "nvidia-container-cli: initialization error: load library failed: libnvidia-ml.so.1"
// REF: issue-291
// SOURCE: n/a
// FORMAT THEOREM: forall s: contains_nvidia_runtime_marker(s) -> nvidia_runtime_failure(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: detection is monotonic over output text; adding unrelated text cannot flip true to false
// COMPLEXITY: O(n * m) where n = |details| and m = marker count
export const isNvidiaRuntimeFailure = (details: string | undefined): boolean => {
  const normalized = details?.toLowerCase() ?? ""
  return nvidiaFailureMarkers.some((marker) => normalized.includes(marker))
}

// CHANGE: derive the safe GPU fallback mode after a Docker runtime failure.
// WHY: non-GPU containers must remain startable on hosts without a working NVIDIA userspace stack.
// QUOTE(ТЗ): "load library failed: libnvidia-ml.so.1"
// REF: issue-291
// SOURCE: n/a
// FORMAT THEOREM: forall g,e: fallback(g,e) = none iff g = all and nvidia_runtime_failure(e)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: gpu=none is idempotent and never escalates to gpu=all
// COMPLEXITY: O(n * m) where n = |details| and m = marker count
export const gpuModeAfterDockerFailure = (
  gpu: GpuMode,
  details: string | undefined
): GpuMode => gpu === "all" && isNvidiaRuntimeFailure(details) ? "none" : gpu
/* jscpd:ignore-end */
