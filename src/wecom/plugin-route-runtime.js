import { createWecomRegisterRuntime } from "./register-runtime.js";
import { createWecomRouteRegistrar } from "./route-registration.js";

function assertObject(name, value) {
  if (!value || typeof value !== "object") {
    throw new Error(`createWecomPluginRouteRuntime: ${name} is required`);
  }
}

export function createWecomPluginRouteRuntime({
  routeRegistrarDeps,
  registerRuntimeDeps,
} = {}) {
  assertObject("routeRegistrarDeps", routeRegistrarDeps);
  assertObject("registerRuntimeDeps", registerRuntimeDeps);

  const wecomRouteRegistrar = createWecomRouteRegistrar(routeRegistrarDeps);
  const { register: registerWecomRuntime } = createWecomRegisterRuntime({
    ...registerRuntimeDeps,
    wecomRouteRegistrar,
  });

  return {
    wecomRouteRegistrar,
    registerWecomRuntime,
  };
}
