if (
  process.env.NODE_ENV === "production" &&
  process.env.THUNDERSTRUX_RUNTIME_CONTAINER === "true"
) {
  throw new Error(
    "Do not run pnpm build inside a running container. Rebuild using docker compose."
  );
}
