# Step 6 Checkpoint Output

## cargo nextest run

```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.90s
────────────
 Nextest run ID 3ab26dba-b925-4131-84d3-4964d99e1c43 with nextest profile: default
    Starting 874 tests across 15 binaries (9 tests skipped)
────────────
     Summary [   4.780s] 874 tests run: 874 passed, 9 skipped
```

## cargo fmt --all --check

```
(no output — formatting is clean)
exit: 0
```

## cargo build

```
   Compiling tugcode v0.7.34
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.65s
```

## cargo clippy --all-targets -- -D warnings

```
    Checking tugcast v0.1.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.56s
```
