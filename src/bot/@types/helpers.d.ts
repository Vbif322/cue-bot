/** Converts Date fields to string (JSON serialization via c.json()) */
export type Serialize<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};
