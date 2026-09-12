import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const desktop = path.resolve(import.meta.dirname, "..");
const run = (program, args) => execFileSync(program, args, { cwd: desktop, stdio: "inherit" });

mkdirSync(path.join(desktop, "dist-native"), { recursive: true });

if (process.platform === "darwin") {
  run("clang", ["-O2", "-mmacosx-version-min=12.0", "-fobjc-arc", "-framework", "AppKit", "-framework", "ApplicationServices", "native/quick_ask.m", "-o", "dist-native/shinbo-option-tap"]);
  run(path.join(desktop, "dist-native/shinbo-option-tap"), ["--self-test"]);
  run("clang", ["-Wall", "-Wextra", "-Werror", "-O2", "-mmacosx-version-min=12.0", "-fobjc-arc", "-framework", "AppKit", "-framework", "ApplicationServices", "native/computer.m", "-o", "dist-native/shinbo-computer"]);
  run(path.join(desktop, "dist-native/shinbo-computer"), ["--self-test"]);
  run("clang", ["-O2", "-mmacosx-version-min=12.0", "-fobjc-arc", "-framework", "Foundation", "-framework", "Speech", "native/transcribe.m", "-o", "dist-native/shinbo-transcribe"]);
  run("clang", ["-O2", "-mmacosx-version-min=12.0", "native/pty.c", "-o", "dist-native/shinbo-pty"]);
  run(path.join(desktop, "dist-native/shinbo-pty"), ["--self-test"]);
} else if (process.platform === "win32") {
  const resource = "dist-native/shinbo-windows-helper.res";
  run("rc.exe", ["/nologo", "/fo", resource, "native/windows-helper.rc"]);
  run("clang", ["-O2", "-Wall", "-Wextra", "-Werror", "-municode", "native/pty_win.c", resource, "-o", "dist-native/shinbo-pty.exe"]);
  run(path.join(desktop, "dist-native/shinbo-pty.exe"), ["--self-test"]);
  run("clang++", ["-O2", "-std=c++20", "-Wall", "-Wextra", "-Werror", "native/quick_ask_win.cpp", resource, "-luser32", "-o", "dist-native/shinbo-option-tap.exe"]);
  run(path.join(desktop, "dist-native/shinbo-option-tap.exe"), ["--self-test"]);
  run("clang++", ["-O2", "-std=c++20", "-Wall", "-Wextra", "-Werror", "-municode", "native/transcribe_win.cpp", resource, "-lsapi", "-lole32", "-o", "dist-native/shinbo-transcribe.exe"]);
  run(path.join(desktop, "dist-native/shinbo-transcribe.exe"), ["--self-test"]);
  const computer = path.join(desktop, "native/computer_win.cpp");
  if (!existsSync(computer)) throw new Error(`Missing Windows computer helper source: ${computer}`);
  run("clang++", ["-O2", "-std=c++20", "-Wall", "-Wextra", "-Werror", computer, resource, "-ladvapi32", "-lole32", "-loleaut32", "-lshell32", "-luiautomationcore", "-luser32", "-luuid", "-municode", "-o", "dist-native/shinbo-computer.exe"]);
  run(path.join(desktop, "dist-native/shinbo-computer.exe"), ["--self-test"]);
}
