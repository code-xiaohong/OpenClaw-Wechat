import { createWecomPluginRuntimeComposition } from "./plugin-composition.js";

const { register, internal } = createWecomPluginRuntimeComposition();

export default register;
export const __internal = internal;
