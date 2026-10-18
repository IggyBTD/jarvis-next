// Starts the sidecars this machine hosts (OpenCode, guarded browser). Filled in by the OpenCode and browser phases.
export async function startSidecars() {
  return { sidecars: {}, stopSidecars: async () => {} };
}
