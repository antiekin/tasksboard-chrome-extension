"""Entry point: daily cleanup of completed tasks from todo.md (run ~03:00 by LaunchAgent)."""
import urllib3
urllib3.disable_warnings()

import archive

if __name__ == "__main__":
    n = archive.cleanup_completed_from_todo()
    print(f"[cleanup] removed {n} completed tasks from todo.md")
