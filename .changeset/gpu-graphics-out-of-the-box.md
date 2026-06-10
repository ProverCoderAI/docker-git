---
"@prover-coder-ai/docker-git": minor
---

Make GPU access work out of the box for `gpu: "all"` projects. Generated dev containers now receive `NVIDIA_DRIVER_CAPABILITIES=all` and `NVIDIA_VISIBLE_DEVICES=all` (so the NVIDIA runtime injects the graphics/display libraries — `libGLX_nvidia`, `libEGL_nvidia` — not just compute), and the image registers the NVIDIA EGL vendor ICD at `/usr/share/glvnd/egl_vendor.d/10_nvidia.json`. This removes the manual per-container env edit, recreate, and vendor-JSON copy previously needed to get graphical GPU/EGL working over SSH. Non-GPU projects are unaffected.
