#!/usr/bin/env rust-script
//! Test script for crates.io version check logic
//! Validates that the check_version_on_crates_io function works correctly
//!
//! ```cargo
//! [dependencies]
//! ureq = "2"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

use serde::Deserialize;

#[derive(Deserialize)]
struct CratesIoVersion {
    version: Option<CratesIoVersionInfo>,
}

#[derive(Deserialize)]
struct CratesIoVersionInfo {
    #[allow(dead_code)]
    num: String,
}

fn check_version_on_crates_io(crate_name: &str, version: &str) -> bool {
    let url = format!("https://crates.io/api/v1/crates/{}/{}", crate_name, version);

    match ureq::get(&url)
        .set("User-Agent", "rust-script-version-and-commit")
        .call()
    {
        Ok(response) => {
            if response.status() == 200 {
                if let Ok(body) = response.into_string() {
                    if let Ok(data) = serde_json::from_str::<CratesIoVersion>(&body) {
                        return data.version.is_some();
                    }
                }
            }
            false
        }
        Err(ureq::Error::Status(404, _)) => false,
        Err(e) => {
            eprintln!("Warning: Could not check crates.io: {}", e);
            false
        }
    }
}

fn main() {
    let mut passed = 0;
    let mut failed = 0;

    // Test 1: Known published crate version (serde 1.0.0 is guaranteed to exist)
    print!("Test 1: Known published version (serde 1.0.0)... ");
    let result = check_version_on_crates_io("serde", "1.0.0");
    if result {
        println!("PASS");
        passed += 1;
    } else {
        println!("FAIL (expected true, got false)");
        failed += 1;
    }

    // Test 2: Non-existent version of a known crate
    print!("Test 2: Non-existent version (serde 999.999.999)... ");
    let result = check_version_on_crates_io("serde", "999.999.999");
    if !result {
        println!("PASS");
        passed += 1;
    } else {
        println!("FAIL (expected false, got true)");
        failed += 1;
    }

    // Test 3: Completely non-existent crate
    print!("Test 3: Non-existent crate (this-crate-definitely-does-not-exist-12345 0.1.0)... ");
    let result = check_version_on_crates_io("this-crate-definitely-does-not-exist-12345", "0.1.0");
    if !result {
        println!("PASS");
        passed += 1;
    } else {
        println!("FAIL (expected false, got true)");
        failed += 1;
    }

    // Test 4: Another known version (regex 1.0.0)
    print!("Test 4: Known published version (regex 1.0.0)... ");
    let result = check_version_on_crates_io("regex", "1.0.0");
    if result {
        println!("PASS");
        passed += 1;
    } else {
        println!("FAIL (expected true, got false)");
        failed += 1;
    }

    println!();
    println!("Results: {} passed, {} failed", passed, failed);

    if failed > 0 {
        std::process::exit(1);
    }
}
