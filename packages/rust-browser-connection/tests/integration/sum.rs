use std::process::Command;

#[test]
fn test_cli_default_args() {
    let output = Command::new(env!("CARGO_BIN_EXE_example-sum-package-name"))
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "0");
}

#[test]
fn test_cli_sum_two_numbers() {
    let output = Command::new(env!("CARGO_BIN_EXE_example-sum-package-name"))
        .args(["--a", "3", "--b", "7"])
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "10");
}

#[test]
fn test_cli_negative_numbers() {
    let output = Command::new(env!("CARGO_BIN_EXE_example-sum-package-name"))
        .args(["--a", "-5", "--b", "3"])
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "-2");
}
