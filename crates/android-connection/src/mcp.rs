use crate::{android_tools, AndroidSpec, SERVER_NAME};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

#[derive(Clone, Debug)]
pub struct McpState {
    pub spec: AndroidSpec,
    pub workspace: PathBuf,
    pub adb_probe: bool,
    pub allow_install: bool,
}

#[derive(Debug)]
enum McpToolError {
    MissingArgument(&'static str),
    InvalidArgument(String),
    AdbProbeDisabled,
    CommandFailed(String),
    Io(String),
}

impl std::fmt::Display for McpToolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingArgument(name) => write!(formatter, "missing required argument: {name}"),
            Self::InvalidArgument(message) => write!(formatter, "invalid argument: {message}"),
            Self::AdbProbeDisabled => write!(formatter, "ADB probing is disabled for this server"),
            Self::CommandFailed(message) => write!(formatter, "{message}"),
            Self::Io(message) => write!(formatter, "{message}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

pub fn run_stdio<R, W>(reader: &mut R, writer: &mut W, state: McpState) -> io::Result<()>
where
    R: BufRead,
    W: Write,
{
    while let Some(raw) = read_next_message(reader)? {
        let response = match serde_json::from_str::<JsonRpcRequest>(&raw) {
            Ok(request) => handle_request(&request, &state),
            Err(error) => Some(json_rpc_error(
                Value::Null,
                -32700,
                &format!("invalid JSON-RPC request: {error}"),
            )),
        };

        if let Some(value) = response {
            write_json_message(writer, &value)?;
        }
    }

    Ok(())
}

fn read_next_message<R: BufRead>(reader: &mut R) -> io::Result<Option<String>> {
    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            return Ok(None);
        }

        let first_line = line.trim_end_matches(['\r', '\n']);
        if first_line.is_empty() {
            continue;
        }

        if let Some(length) = parse_content_length(first_line)? {
            read_headers(reader)?;
            let mut payload = vec![0_u8; length];
            reader.read_exact(&mut payload)?;
            return String::from_utf8(payload)
                .map(Some)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
        }

        return Ok(Some(first_line.to_string()));
    }
}

fn parse_content_length(header: &str) -> io::Result<Option<usize>> {
    let lowercase = header.to_ascii_lowercase();
    if !lowercase.starts_with("content-length:") {
        return Ok(None);
    }

    let raw_length = header
        .split_once(':')
        .map(|(_, value)| value.trim())
        .unwrap_or_default();
    raw_length
        .parse::<usize>()
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn read_headers<R: BufRead>(reader: &mut R) -> io::Result<()> {
    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            return Ok(());
        }
        if line.trim().is_empty() {
            return Ok(());
        }
    }
}

fn write_json_message<W: Write>(writer: &mut W, value: &Value) -> io::Result<()> {
    let body = serde_json::to_string(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body)?;
    writer.flush()
}

fn handle_request(request: &JsonRpcRequest, state: &McpState) -> Option<Value> {
    if request.id.is_none() && request.method.starts_with("notifications/") {
        return None;
    }

    let id = request.id.clone().unwrap_or(Value::Null);
    let response = match request.method.as_str() {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": SERVER_NAME,
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
        "tools/list" => json!({ "tools": render_tools() }),
        "tools/call" => return Some(handle_tools_call(id, request.params.as_ref(), state)),
        method => {
            return Some(json_rpc_error(
                id,
                -32601,
                &format!("method not found: {method}"),
            ))
        }
    };

    Some(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": response
    }))
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn render_tools() -> Value {
    Value::Array(
        android_tools()
            .into_iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": true
                    }
                })
            })
            .collect(),
    )
}

fn handle_tools_call(id: Value, params: Option<&Value>, state: &McpState) -> Value {
    let result = call_tool_from_params(params, state);
    let (text, is_error) = match result {
        Ok(text) => (text, false),
        Err(error) => (error.to_string(), true),
    };

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": text
                }
            ],
            "isError": is_error
        }
    })
}

fn call_tool_from_params(params: Option<&Value>, state: &McpState) -> Result<String, McpToolError> {
    let params =
        params.ok_or_else(|| McpToolError::InvalidArgument("missing params".to_string()))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| McpToolError::InvalidArgument("missing tool name".to_string()))?;
    let arguments = params.get("arguments").unwrap_or(&Value::Null);

    match name {
        "android_status" => android_status(state),
        "android_devices" => android_devices(state),
        "android_screenshot" => android_screenshot(state, arguments),
        "android_tap" => android_tap(state, arguments),
        "android_swipe" => android_swipe(state, arguments),
        "android_type_text" => android_type_text(state, arguments),
        "android_press_key" => android_press_key(state, arguments),
        "android_launch_app" => android_launch_app(state, arguments),
        "android_open_url" => android_open_url(state, arguments),
        "android_logcat" => android_logcat(state, arguments),
        "android_install_apk" => android_install_apk(state, arguments),
        unknown => Err(McpToolError::InvalidArgument(format!(
            "unknown Android MCP tool: {unknown}"
        ))),
    }
}

fn android_status(state: &McpState) -> Result<String, McpToolError> {
    if !state.adb_probe {
        return serde_json::to_string_pretty(&json!({
            "server": SERVER_NAME,
            "adbProbe": false,
            "spec": state.spec
        }))
        .map_err(|error| McpToolError::Io(error.to_string()));
    }

    match run_adb(state, &["devices".to_string()]) {
        Ok(output) => Ok(format!(
            "Android runtime: {}\nADB endpoint: {}\n\n{}",
            state.spec.android_container_name, state.spec.adb_endpoint, output
        )),
        Err(error) => Ok(format!(
            "Android runtime: {}\nADB endpoint: {}\nADB status error: {}",
            state.spec.android_container_name, state.spec.adb_endpoint, error
        )),
    }
}

fn android_devices(state: &McpState) -> Result<String, McpToolError> {
    run_adb(state, &["devices".to_string()])
}

fn android_tap(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let x = integer_argument(arguments, "x")?;
    let y = integer_argument(arguments, "y")?;
    run_adb(
        state,
        &[
            "shell".to_string(),
            "input".to_string(),
            "tap".to_string(),
            x.to_string(),
            y.to_string(),
        ],
    )
}

fn android_swipe(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let start_x = integer_argument(arguments, "startX")?;
    let start_y = integer_argument(arguments, "startY")?;
    let end_x = integer_argument(arguments, "endX")?;
    let end_y = integer_argument(arguments, "endY")?;
    let duration_ms = optional_integer_argument(arguments, "durationMs")?.unwrap_or(300);
    run_adb(
        state,
        &[
            "shell".to_string(),
            "input".to_string(),
            "swipe".to_string(),
            start_x.to_string(),
            start_y.to_string(),
            end_x.to_string(),
            end_y.to_string(),
            duration_ms.to_string(),
        ],
    )
}

fn android_type_text(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let text = string_argument(arguments, "text")?.replace(' ', "%s");
    run_adb(
        state,
        &[
            "shell".to_string(),
            "input".to_string(),
            "text".to_string(),
            text,
        ],
    )
}

fn android_press_key(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let keycode = string_argument(arguments, "keycode")?;
    if !keycode
        .bytes()
        .all(|byte| matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_'))
    {
        return Err(McpToolError::InvalidArgument(
            "keycode may contain only ASCII letters, digits, and '_'".to_string(),
        ));
    }
    run_adb(
        state,
        &[
            "shell".to_string(),
            "input".to_string(),
            "keyevent".to_string(),
            keycode,
        ],
    )
}

fn android_launch_app(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let package_name = string_argument(arguments, "package")?;
    let activity = optional_string_argument(arguments, "activity")?;
    match activity {
        Some(activity) if !activity.is_empty() => run_adb(
            state,
            &[
                "shell".to_string(),
                "am".to_string(),
                "start".to_string(),
                "-n".to_string(),
                format!("{package_name}/{activity}"),
            ],
        ),
        _ => run_adb(
            state,
            &[
                "shell".to_string(),
                "monkey".to_string(),
                "-p".to_string(),
                package_name,
                "-c".to_string(),
                "android.intent.category.LAUNCHER".to_string(),
                "1".to_string(),
            ],
        ),
    }
}

fn android_open_url(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let url = string_argument(arguments, "url")?;
    run_adb(
        state,
        &[
            "shell".to_string(),
            "am".to_string(),
            "start".to_string(),
            "-a".to_string(),
            "android.intent.action.VIEW".to_string(),
            "-d".to_string(),
            url,
        ],
    )
}

fn android_logcat(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let lines = optional_integer_argument(arguments, "lines")?
        .unwrap_or(200)
        .clamp(1, 1000);
    run_adb(
        state,
        &[
            "logcat".to_string(),
            "-d".to_string(),
            "-t".to_string(),
            lines.to_string(),
        ],
    )
}

fn android_screenshot(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    let output_path = optional_string_argument(arguments, "path")?
        .unwrap_or_else(|| "android-screenshot.png".to_string());
    let target_path = workspace_path(&state.workspace, &output_path)?;
    let output = run_adb_raw(
        state,
        &[
            "exec-out".to_string(),
            "screencap".to_string(),
            "-p".to_string(),
        ],
    )?;
    if !output.status.success() {
        return Err(McpToolError::CommandFailed(command_failure(
            "adb screenshot",
            output,
        )));
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| McpToolError::Io(error.to_string()))?;
    }
    fs::write(&target_path, output.stdout).map_err(|error| McpToolError::Io(error.to_string()))?;
    Ok(format!("screenshot written to {}", target_path.display()))
}

fn android_install_apk(state: &McpState, arguments: &Value) -> Result<String, McpToolError> {
    if !state.allow_install {
        return Err(McpToolError::InvalidArgument(
            "APK installation requires --allow-install".to_string(),
        ));
    }
    let apk_path = string_argument(arguments, "path")?;
    let target_path = workspace_path(&state.workspace, &apk_path)?;
    run_adb(
        state,
        &["install".to_string(), target_path.display().to_string()],
    )
}

fn run_adb(state: &McpState, args: &[String]) -> Result<String, McpToolError> {
    let output = run_adb_raw(state, args)?;
    output_to_text("adb", output)
}

fn run_adb_raw(state: &McpState, args: &[String]) -> Result<Output, McpToolError> {
    if !state.adb_probe {
        return Err(McpToolError::AdbProbeDisabled);
    }

    let connect_output = Command::new("adb")
        .arg("connect")
        .arg(&state.spec.adb_endpoint)
        .output()
        .map_err(|error| {
            McpToolError::CommandFailed(format!("failed to execute adb connect: {error}"))
        })?;
    if !connect_output.status.success() {
        return Err(McpToolError::CommandFailed(command_failure(
            "adb connect",
            connect_output,
        )));
    }

    Command::new("adb")
        .args(args)
        .output()
        .map_err(|error| McpToolError::CommandFailed(format!("failed to execute adb: {error}")))
}

fn output_to_text(label: &str, output: Output) -> Result<String, McpToolError> {
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(match (stdout.is_empty(), stderr.is_empty()) {
            (true, true) => format!("{label} completed successfully"),
            (false, true) => stdout,
            (true, false) => stderr,
            (false, false) => format!("{stdout}\n{stderr}"),
        });
    }

    Err(McpToolError::CommandFailed(command_failure(label, output)))
}

fn command_failure(label: &str, output: Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!(
        "{label} failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status.code(),
        stdout.trim(),
        stderr.trim()
    )
}

fn integer_argument(arguments: &Value, name: &'static str) -> Result<i64, McpToolError> {
    arguments
        .get(name)
        .and_then(Value::as_i64)
        .ok_or(McpToolError::MissingArgument(name))
}

fn optional_integer_argument(
    arguments: &Value,
    name: &'static str,
) -> Result<Option<i64>, McpToolError> {
    match arguments.get(name) {
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| McpToolError::InvalidArgument(format!("{name} must be an integer"))),
        None => Ok(None),
    }
}

fn string_argument(arguments: &Value, name: &'static str) -> Result<String, McpToolError> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or(McpToolError::MissingArgument(name))
}

fn optional_string_argument(
    arguments: &Value,
    name: &'static str,
) -> Result<Option<String>, McpToolError> {
    match arguments.get(name) {
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_string()))
            .ok_or_else(|| McpToolError::InvalidArgument(format!("{name} must be a string"))),
        None => Ok(None),
    }
}

fn workspace_path(workspace: &Path, value: &str) -> Result<PathBuf, McpToolError> {
    let candidate = PathBuf::from(value);
    if value.is_empty()
        || candidate.is_absolute()
        || candidate
            .components()
            .any(|component| component == Component::ParentDir)
    {
        return Err(McpToolError::InvalidArgument(
            "path must be relative, non-empty, and must not contain '..'".to_string(),
        ));
    }

    Ok(workspace.join(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{android_spec, DEFAULT_ANDROID_IMAGE};
    use std::io::Cursor;

    fn test_state() -> McpState {
        McpState {
            spec: android_spec(
                "dg-test",
                "docker-git-shared",
                "dg-test-android:5555",
                DEFAULT_ANDROID_IMAGE,
            )
            .expect("valid android spec"),
            workspace: PathBuf::from("/workspace"),
            adb_probe: false,
            allow_install: false,
        }
    }

    fn frame(value: Value) -> String {
        let payload = serde_json::to_string(&value).expect("serializable request");
        format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload)
    }

    #[test]
    fn serves_initialize_and_tools_list_over_framed_stdio() {
        let input = format!(
            "{}{}",
            frame(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {}
            })),
            frame(json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }))
        );
        let mut reader = Cursor::new(input.into_bytes());
        let mut output = Vec::new();

        run_stdio(&mut reader, &mut output, test_state()).expect("stdio server succeeds");

        let output_text = String::from_utf8(output).expect("valid utf8 output");
        assert!(output_text.contains(SERVER_NAME));
        assert!(output_text.contains("android_status"));
        assert!(output_text.contains("android_tap"));
    }

    #[test]
    fn reports_status_without_adb_when_probe_is_disabled() {
        let input = frame(json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "android_status",
                "arguments": {}
            }
        }));
        let mut reader = Cursor::new(input.into_bytes());
        let mut output = Vec::new();

        run_stdio(&mut reader, &mut output, test_state()).expect("status succeeds");

        let output_text = String::from_utf8(output).expect("valid utf8 output");
        assert!(output_text.contains("\"isError\":false"));
        assert!(output_text.contains("adbProbe"));
        assert!(output_text.contains("false"));
        assert!(output_text.contains("dg-test-android"));
    }

    #[test]
    fn rejects_workspace_paths_outside_workspace() {
        let workspace = PathBuf::from("/workspace");

        assert!(workspace_path(&workspace, "screenshots/current.png").is_ok());
        assert!(workspace_path(&workspace, "/tmp/outside.png").is_err());
        assert!(workspace_path(&workspace, "../outside.png").is_err());
        assert!(workspace_path(&workspace, "screenshots/../outside.png").is_err());
    }
}
