import type { StonksDriver } from "./types";
import { yahooFinanceDriver } from "./yahoo-finance";

export const STONKS_DRIVERS: StonksDriver[] = [yahooFinanceDriver];

export function getDriver(id: string): StonksDriver | undefined {
  return STONKS_DRIVERS.find((d) => d.id === id);
}
