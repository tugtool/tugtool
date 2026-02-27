/**
 * useConnection — React hook that provides the TugConnection instance.
 *
 * Reads from CardContext. Components using this hook must be rendered inside
 * a CardContextProvider.
 */

import { useContext } from "react";
import { CardContext } from "../cards/card-context";

export function useConnection() {
  const ctx = useContext(CardContext);
  return ctx.connection;
}
