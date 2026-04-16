#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if caprail_lib::maybe_run_paddle_sidecar_from_args() {
        return;
    }

    caprail_lib::run()
}
