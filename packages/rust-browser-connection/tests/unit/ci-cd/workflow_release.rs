use std::fs;

fn release_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .replace("\r\n", "\n")
}

fn job_block<'a>(workflow: &'a str, job_name: &str) -> &'a str {
    let marker = format!("  {job_name}:\n");
    let start = workflow.find(&marker).unwrap();
    let body_start = start + marker.len();
    let rest = &workflow[body_start..];

    let next_job = rest
        .lines()
        .scan(0usize, |offset, line| {
            let current_offset = *offset;
            *offset += line.len() + 1;
            Some((current_offset, line))
        })
        .find_map(|(offset, line)| {
            let starts_at_job_indent = line.starts_with("  ") && !line.starts_with("    ");
            (starts_at_job_indent && line.trim_end().ends_with(':')).then_some(offset)
        });

    next_job.map_or_else(
        || &workflow[start..],
        |end| &workflow[start..body_start + end],
    )
}

fn workflow_job_names(workflow: &str) -> Vec<&str> {
    let marker = "jobs:\n";
    let start = workflow.find(marker).unwrap() + marker.len();

    workflow[start..]
        .lines()
        .filter_map(|line| {
            let starts_at_job_indent = line.starts_with("  ") && !line.starts_with("    ");
            (starts_at_job_indent && line.trim_end().ends_with(':'))
                .then(|| line.trim().trim_end_matches(':'))
        })
        .collect()
}

#[test]
fn documentation_deploy_is_independent_from_release_publication() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");

    assert!(deploy_docs.contains("needs: [build]"));
    assert!(deploy_docs.contains("needs.build.result == 'success'"));
    assert!(deploy_docs.contains("github.ref == 'refs/heads/main'"));
    assert!(!deploy_docs.contains("needs: [auto-release, manual-release]"));
    assert!(!deploy_docs.contains("needs.auto-release.result"));
    assert!(!deploy_docs.contains("needs.manual-release.result"));
}

#[test]
fn documentation_deploy_uses_github_pages_artifact_flow() {
    let workflow = release_workflow();
    let deploy_docs = job_block(&workflow, "deploy-docs");

    assert!(deploy_docs.contains("contents: read"));
    assert!(deploy_docs.contains("pages: write"));
    assert!(deploy_docs.contains("id-token: write"));
    assert!(deploy_docs.contains("environment:"));
    assert!(deploy_docs.contains("name: github-pages"));
    assert!(deploy_docs.contains("url: ${{ steps.deployment.outputs.page_url }}"));
    assert!(deploy_docs.contains("uses: actions/configure-pages@v6"));
    assert!(deploy_docs.contains("uses: actions/upload-pages-artifact@v5"));
    assert!(deploy_docs.contains("path: target/doc"));
    assert!(deploy_docs.contains("id: deployment"));
    assert!(deploy_docs.contains("uses: actions/deploy-pages@v5"));
    assert!(!deploy_docs.contains("contents: write"));
    assert!(!deploy_docs.contains("peaceiris/actions-gh-pages"));
    assert!(!deploy_docs.contains("publish_dir: target/doc"));
}

#[test]
fn release_workflow_jobs_have_explicit_timeouts() {
    let workflow = release_workflow();
    let expected_timeouts = [
        ("detect-changes", 5),
        ("changelog", 10),
        ("version-check", 5),
        ("lint", 10),
        ("test", 10),
        ("coverage", 15),
        ("build", 10),
        ("auto-release", 30),
        ("manual-release", 30),
        ("changelog-pr", 10),
        ("deploy-docs", 15),
    ];

    let actual_jobs = workflow_job_names(&workflow);
    let expected_jobs = expected_timeouts
        .iter()
        .map(|(job_name, _)| *job_name)
        .collect::<Vec<_>>();
    assert_eq!(actual_jobs, expected_jobs);

    for (job_name, timeout_minutes) in expected_timeouts {
        let job = job_block(&workflow, job_name);
        let expected = format!("    timeout-minutes: {timeout_minutes}\n");
        assert!(
            job.contains(&expected),
            "{job_name} should declare {expected:?}"
        );
    }
}

#[test]
fn release_workflow_publishes_optional_docker_hub_image_after_crate_is_visible() {
    let workflow = release_workflow();

    assert!(
        workflow.contains("DOCKERHUB_IMAGE: ${{ vars.DOCKERHUB_IMAGE }}"),
        "workflow should expose an opt-in Docker Hub image variable"
    );
    assert_eq!(
        workflow.matches("docker/login-action@v4").count(),
        2,
        "auto and manual release jobs should log in to Docker Hub when configured"
    );
    assert_eq!(
        workflow.matches("docker/metadata-action@v6").count(),
        2,
        "auto and manual release jobs should derive Docker tags for Docker Hub"
    );
    assert_eq!(
        workflow.matches("docker/build-push-action@v7").count(),
        2,
        "auto and manual release jobs should publish Docker Hub images when configured"
    );
    assert!(
        workflow.contains("password: ${{ env.DOCKERHUB_TOKEN }}"),
        "Docker Hub login should use DOCKERHUB_TOKEN"
    );

    let auto_release = job_block(&workflow, "auto-release");
    let auto_publish = auto_release
        .find("- name: Publish to Crates.io")
        .expect("auto release should publish the crate");
    let auto_wait = auto_release
        .find("- name: Wait for Crate availability on Crates.io")
        .expect("auto release should wait for the crate");
    let auto_docker = auto_release
        .find("- name: Publish Docker image to Docker Hub")
        .expect("auto release should publish the Docker image");
    let auto_github_release = auto_release
        .find("- name: Create GitHub Release")
        .expect("auto release should create a GitHub release");

    assert!(
        auto_publish < auto_wait && auto_wait < auto_docker && auto_docker < auto_github_release,
        "auto release should publish crates.io first, then Docker Hub, then GitHub release"
    );

    let manual_release = job_block(&workflow, "manual-release");
    let manual_publish = manual_release
        .find("- name: Publish to Crates.io")
        .expect("manual release should publish the crate");
    let manual_wait = manual_release
        .find("- name: Wait for Crate availability on Crates.io")
        .expect("manual release should wait for the crate");
    let manual_docker = manual_release
        .find("- name: Publish Docker image to Docker Hub")
        .expect("manual release should publish the Docker image");
    let manual_github_release = manual_release
        .find("- name: Create GitHub Release")
        .expect("manual release should create a GitHub release");

    assert!(
        manual_publish < manual_wait
            && manual_wait < manual_docker
            && manual_docker < manual_github_release,
        "manual release should publish crates.io first, then Docker Hub, then GitHub release"
    );
}

#[test]
fn release_scripts_check_configured_release_artifacts() {
    let release_check = fs::read_to_string(format!(
        "{}/scripts/check-release-needed.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let wait_for_crate = fs::read_to_string(format!(
        "{}/scripts/wait-for-crate.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let release_script = fs::read_to_string(format!(
        "{}/scripts/create-github-release.rs",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    assert!(
        release_check.contains("check_docker_hub_tag"),
        "release-needed check should verify configured Docker Hub tags"
    );
    assert!(
        release_check.contains("check_docker_hub_tag(image, \"latest\")"),
        "release-needed check should verify Docker Hub latest tags as part of completeness"
    );
    assert!(
        release_check.contains("check_github_release"),
        "release-needed check should verify GitHub release artifacts"
    );
    assert!(
        release_check.contains("crate_published"),
        "release-needed check should output whether the crate already exists"
    );
    assert!(
        wait_for_crate.contains("crates.io/api/v1/crates"),
        "release workflow should wait for crates.io visibility before image publishing"
    );
    assert!(
        wait_for_crate.contains("example-sum-package-name")
            && wait_for_crate.contains("crate_available\", \"skipped\""),
        "crate availability wait should preserve template-safe publishing skips"
    );
    assert!(
        release_script.contains("--docker-hub-url"),
        "GitHub release creation should accept a Docker Hub URL"
    );
    assert!(
        release_script.contains("fn docker_hub_badge"),
        "GitHub release notes should include Docker Hub badge support"
    );
}
