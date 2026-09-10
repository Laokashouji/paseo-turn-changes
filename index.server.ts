import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contribute } from "./server/runtime";

export default function setup(server: PluginServerContext) {
  return contribute(server);
}
