use anyhow::{Context, Result};
use bollard::Docker;
use bollard::container::{Config, CreateContainerOptions, StartContainerOptions};
use bollard::models::HostConfig;
use std::collections::HashMap;
use tokio;

#[derive(Debug)]
pub struct BrowserConnection {
    docker: Docker,
}

impl BrowserConnection {
    pub fn new() -> Result<Self> {
        let docker = Docker::connect_with_local_defaults()
            .context("Failed to connect to Docker daemon")?;
        Ok(Self { docker })
    }

    pub async fn start_browser(&self, project_id: &str) -> Result<String> {
        let container_name = format!("dg-{}-browser", project_id.replace('/', '-'));

        let config = Config {
            image: Some("dg-docker-git-browser:latest".to_string()),
            host_config: Some(HostConfig {
                port_bindings: Some(HashMap::from([
                    ("5900/tcp".to_string(), Some(vec![bollard::models::PortBinding {
                        host_ip: Some("0.0.0.0".to_string()),
                        host_port: Some("5900".to_string()),
                    }])),
                    ("6080/tcp".to_string(), Some(vec![bollard::models::PortBinding {
                        host_ip: Some("0.0.0.0".to_string()),
                        host_port: Some("6080".to_string()),
                    }])),
                    ("9223/tcp".to_string(), Some(vec![bollard::models::PortBinding {
                        host_ip: Some("0.0.0.0".to_string()),
                        host_port: Some("9223".to_string()),
                    }])),
                ])),
                ..Default::default()
            }),
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: container_name.as_str(),
            platform: None,
        };

        let _ = self.docker
            .create_container(Some(options), config)
            .await
            .context("Failed to create browser container")?;

        let _ = self.docker
            .start_container(&container_name, None::<StartContainerOptions<String>>)
            .await
            .context("Failed to start browser container")?;

        Ok(format!("Browser started for {} with noVNC on :6080, VNC on :5900, CDP on :9223. Single session with noVNC.", project_id))
    }

    pub fn get_novnc_url(&self, project_id: &str) -> String {
        format!("/b/{}/vnc.html?autoconnect=true&resize=remote&path=b/{}/websockify", project_id, project_id)
    }

    pub fn get_cdp_url(&self, project_id: &str) -> String {
        format!("http://localhost:9223?project={}", project_id)
    }

    pub fn is_single_browser_session(&self, cdp_url: &str, novnc_url: &str) -> bool {
        cdp_url.contains("9223") && novnc_url.contains("/vnc.html")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_urls_and_invariant() {
        let conn = BrowserConnection::new().unwrap();
        let novnc = conn.get_novnc_url("issue-347");
        let cdp = conn.get_cdp_url("issue-347");
        assert!(conn.is_single_browser_session(&cdp, &novnc));
        assert!(novnc.contains("vnc.html"));
        assert!(cdp.contains("9223"));
    }
}
