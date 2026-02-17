/**
 * Custom entrypoint that normalizes PRIVATE_KEY before Probot reads it.
 * Railway and other platforms often mangle multi-line env vars.
 */

// Fix PRIVATE_KEY: convert literal \n to real newlines
if (process.env.PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/\\n/g, "\n");
}

import { run } from "probot";
import app from "./index.js";

run(app);
