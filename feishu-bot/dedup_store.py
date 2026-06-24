"""Idempotency store for Feishu message_ids (events are delivered at-least-once)."""
import sqlite3


class DedupStore:
    def __init__(self, db_path):
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS processed (message_id TEXT PRIMARY KEY)"
        )
        self.conn.commit()

    def claim(self, message_id):
        """Return True if this is the first time we see message_id."""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO processed (message_id) VALUES (?)", (message_id,)
        )
        self.conn.commit()
        return cur.rowcount == 1

    def release(self, message_id):
        """Remove the claim so a redelivered event can be retried."""
        self.conn.execute("DELETE FROM processed WHERE message_id = ?", (message_id,))
        self.conn.commit()
