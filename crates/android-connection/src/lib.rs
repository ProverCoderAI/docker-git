pub mod mcp;

use serde::Serialize;

pub const SERVER_NAME: &str = "android-connection";
pub const DEFAULT_ANDROID_IMAGE: &str = "budtmo/docker-android:emulator_14.0";
pub const DEFAULT_ADB_ENDPOINT: &str = "android:5555";
pub const DEFAULT_PROJECT_ID: &str = "docker-git";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EndpointError {
    pub value: String,
}

impl std::fmt::Display for EndpointError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "invalid ADB endpoint {:?}; allowed characters are ASCII letters, digits, '.', '-', '_' and ':'",
            self.value
        )
    }
}

impl std::error::Error for EndpointError {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AndroidSpec {
    pub project_id: String,
    pub project_container_name: String,
    pub android_container_name: String,
    pub android_volume_name: String,
    pub docker_network: String,
    pub adb_endpoint: String,
    pub image: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct McpToolSpec {
    pub name: &'static str,
    pub description: &'static str,
}

// CHANGE: normalize externally supplied project ids into Docker-safe names
// WHY: Android sidecar names are pure functions of the project id, so MCP clients and lifecycle CLI agree
// QUOTE(TZ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: n/a
// FORMAT THEOREM: forall s: normalize(s) in [a-z0-9-]+ and normalize(s) != ""
// PURITY: CORE
// INVARIANT: output is non-empty, lowercase, and contains only Docker-name-safe characters
// COMPLEXITY: O(n)/O(n)
pub fn normalize_project_id(raw: &str) -> String {
    let mut normalized = String::new();
    let mut previous_dash = false;

    for byte in raw.bytes() {
        let next = match byte {
            b'a'..=b'z' | b'0'..=b'9' => Some(byte as char),
            b'A'..=b'Z' => Some(byte.to_ascii_lowercase() as char),
            _ => {
                if normalized.is_empty() || previous_dash {
                    None
                } else {
                    Some('-')
                }
            }
        };

        if let Some(character) = next {
            previous_dash = character == '-';
            normalized.push(character);
        }
    }

    while normalized.ends_with('-') {
        normalized.pop();
    }

    if normalized.is_empty() {
        DEFAULT_PROJECT_ID.to_string()
    } else {
        normalized
    }
}

pub fn android_container_name(project_id: &str) -> String {
    format!("{}-android", normalize_project_id(project_id))
}

pub fn android_volume_name(project_id: &str) -> String {
    format!("{}-home-android", normalize_project_id(project_id))
}

pub fn is_safe_adb_endpoint(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.contains(':')
        && value.bytes().all(|byte| {
            matches!(
                byte,
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' | b'-' | b'_' | b':'
            )
        })
}

pub fn validate_adb_endpoint(value: &str) -> Result<String, EndpointError> {
    if is_safe_adb_endpoint(value) {
        Ok(value.to_string())
    } else {
        Err(EndpointError {
            value: value.to_string(),
        })
    }
}

pub fn android_spec(
    project_id: &str,
    docker_network: &str,
    adb_endpoint: &str,
    image: &str,
) -> Result<AndroidSpec, EndpointError> {
    let normalized = normalize_project_id(project_id);
    Ok(AndroidSpec {
        project_id: normalized.clone(),
        project_container_name: normalized.clone(),
        android_container_name: android_container_name(&normalized),
        android_volume_name: android_volume_name(&normalized),
        docker_network: docker_network.to_string(),
        adb_endpoint: validate_adb_endpoint(adb_endpoint)?,
        image: image.to_string(),
    })
}

pub fn android_tools() -> Vec<McpToolSpec> {
    vec![
        McpToolSpec {
            name: "android_status",
            description: "Return the configured Android runtime and optional ADB status.",
        },
        McpToolSpec {
            name: "android_devices",
            description: "List Android devices visible to adb.",
        },
        McpToolSpec {
            name: "android_screenshot",
            description: "Capture a PNG screenshot into the workspace.",
        },
        McpToolSpec {
            name: "android_tap",
            description: "Tap screen coordinates.",
        },
        McpToolSpec {
            name: "android_swipe",
            description: "Swipe between screen coordinates.",
        },
        McpToolSpec {
            name: "android_type_text",
            description: "Type text into the active Android input field.",
        },
        McpToolSpec {
            name: "android_press_key",
            description: "Send an Android keycode.",
        },
        McpToolSpec {
            name: "android_launch_app",
            description: "Launch an installed Android package.",
        },
        McpToolSpec {
            name: "android_open_url",
            description: "Open a URL through Android intent handling.",
        },
        McpToolSpec {
            name: "android_logcat",
            description: "Read recent logcat output.",
        },
        McpToolSpec {
            name: "android_install_apk",
            description: "Install an APK from the workspace when explicitly enabled.",
        },
    ]
}

pub fn docker_run_args(spec: &AndroidSpec) -> Vec<String> {
    vec![
        "run".to_string(),
        "--detach".to_string(),
        "--name".to_string(),
        spec.android_container_name.clone(),
        "--privileged".to_string(),
        "--network".to_string(),
        spec.docker_network.clone(),
        "--env".to_string(),
        "EMULATOR_HEADLESS=true".to_string(),
        "--env".to_string(),
        "WEB_VNC=true".to_string(),
        "--volume".to_string(),
        format!("{}:/root/.android", spec.android_volume_name),
        spec.image.clone(),
    ]
}

pub fn docker_stop_args(spec: &AndroidSpec) -> Vec<String> {
    vec![
        "rm".to_string(),
        "--force".to_string(),
        spec.android_container_name.clone(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_project_id_to_docker_safe_name() {
        assert_eq!(
            normalize_project_id("Org/Repo:Feature_X"),
            "org-repo-feature-x"
        );
        assert_eq!(normalize_project_id("///"), DEFAULT_PROJECT_ID);
    }

    #[test]
    fn rejects_shell_fragments_in_adb_endpoint() {
        assert!(validate_adb_endpoint("dg-test-android:5555").is_ok());
        assert!(validate_adb_endpoint("dg-test-android:5555;touch /tmp/pwn").is_err());
        assert!(validate_adb_endpoint("$(whoami):5555").is_err());
    }

    #[test]
    fn builds_deterministic_android_spec() {
        let spec = android_spec(
            "dg-test",
            "docker-git-shared",
            "dg-test-android:5555",
            DEFAULT_ANDROID_IMAGE,
        )
        .expect("valid spec");

        assert_eq!(spec.project_container_name, "dg-test");
        assert_eq!(spec.android_container_name, "dg-test-android");
        assert_eq!(spec.android_volume_name, "dg-test-home-android");
    }

    #[test]
    fn advertises_android_mcp_tools() {
        let names: Vec<&str> = android_tools().into_iter().map(|tool| tool.name).collect();
        assert!(names.contains(&"android_status"));
        assert!(names.contains(&"android_tap"));
        assert!(names.contains(&"android_install_apk"));
    }
}
