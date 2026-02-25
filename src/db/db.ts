import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. " +
      "Please add DATABASE_URL to your .env file"
  );
}

export const db = drizzle(DATABASE_URL, {
  schema,
});
