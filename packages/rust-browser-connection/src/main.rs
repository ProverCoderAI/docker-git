use lino_arguments::Parser;

use example_sum_package_name::sum;

#[derive(Parser, Debug)]
#[command(name = "example-sum-package-name", about = "Sum two numbers")]
struct Args {
    #[arg(long, env = "A", default_value = "0", allow_hyphen_values = true)]
    a: i64,

    #[arg(long, env = "B", default_value = "0", allow_hyphen_values = true)]
    b: i64,
}

fn main() {
    let args = Args::parse();
    println!("{}", sum(args.a, args.b));
}
