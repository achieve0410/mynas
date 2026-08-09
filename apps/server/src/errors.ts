import type { Context } from "hono";
import { z } from "zod";

import { AuthError } from "../../../packages/auth/src/auth";
import { PhotoError } from "../../../packages/photos/src/photos";
import { CatalogError } from "../../../packages/storage/src/catalog";
import { MirrorError } from "../../../packages/storage/src/mirror";
import { RegistryError } from "../../../packages/storage/src/registry";

import type { AppEnvironment } from "./types";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 503;

const domainErrorStatus = (error: unknown): ErrorStatus => {
  if (error instanceof AuthError) {
    if (error.code === "setup_forbidden") {
      return 403;
    }
    if (error.code === "setup_complete") {
      return 409;
    }
    if (error.code === "invalid_input") {
      return 400;
    }
    return 401;
  }
  if (error instanceof RegistryError) {
    if (error.code === "conflict") {
      return 409;
    }
    if (error.code === "not_found") {
      return 404;
    }
    return error.code === "unavailable" ? 503 : 400;
  }
  if (error instanceof MirrorError) {
    if (error.code === "not_found") {
      return 404;
    }
    if (error.code === "unrecoverable") {
      return 503;
    }
    return 409;
  }
  if (error instanceof CatalogError) {
    return error.code === "not_found" ? 404 : 400;
  }
  if (error instanceof PhotoError) {
    return error.code === "not_found" ? 404 : 400;
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return 400;
  }
  return 500;
};

export const errorResponse = (context: Context<AppEnvironment>, error: unknown): Response => {
  const status = domainErrorStatus(error);
  const message =
    status === 500
      ? "internal server error"
      : error instanceof Error
        ? error.message
        : "request failed";
  return context.json(
    {
      error: {
        code: status === 500 ? "internal_error" : "request_failed",
        message,
      },
    },
    status,
  );
};
