import { parseRelayList } from "./relay-parser";
import type { RelayRecord } from "./relay-types";

export async function loadRelaysFromMullvadCli(): Promise<RelayRecord[]> {
  const proc = Bun.spawn(["mullvad", "relay", "list"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `mullvad relay list failed: ${stderr.trim() || `exit code ${exitCode}`}`,
    );
  }

  return parseRelayList(stdout);
}
