import "server-only";

// Identity now comes from our own wisc.edu login (see ./auth.ts), not the Databricks Apps header.
export { currentUser, requireUser, type User } from "./auth";
