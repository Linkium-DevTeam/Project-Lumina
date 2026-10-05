import type { UserRow } from "./db.js";

export interface Env {
  Variables: {
    userId: number;
    user: UserRow;
  };
}
