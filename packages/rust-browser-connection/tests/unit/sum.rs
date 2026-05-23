use example_sum_package_name::sum;

#[test]
fn test_sum_positive_numbers() {
    assert_eq!(sum(2, 3), 5);
}

#[test]
fn test_sum_negative_numbers() {
    assert_eq!(sum(-1, -2), -3);
}

#[test]
fn test_sum_zero() {
    assert_eq!(sum(5, 0), 5);
}

#[test]
fn test_sum_large_numbers() {
    assert_eq!(sum(1_000_000, 2_000_000), 3_000_000);
}

#[test]
fn test_sum_mixed_sign() {
    assert_eq!(sum(-100, 50), -50);
}
