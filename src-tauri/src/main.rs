// Prevents an extra console window on Windows in release; no effect on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easyenv_lib::run()
}
