import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPortalPass, hasPortalConfig, PortalError, type PortalPass } from "./data/client";
import {
  fetchMrData,
  fetchSalespeople,
  fetchSellers,
  MR_DATA_QK,
  MR_QK,
  MR_SALESPEOPLE_QK,
  MR_SELLERS_QK,
} from "./data/mrFetch";
import type {
  Category,
  FieldDef,
  Inquiry,
  Machine,
  MasterKind,
  MasterValue,
  MrData,
  PrintHead,
  Salesperson,
  SellerOption,
} from "./types";

const EMPTY: MrData = {
  categories: [],
  printHeads: [],
  masters: [],
  fields: [],
  settings: [],
  machines: [],
  inquiries: [],
};

interface MrStore extends MrData {
  isLoading: boolean;
  error: unknown;
  pass: PortalPass | null;
  /**
   * Edit rights come from the PASS, not the hub session: the pass carries the level
   * the portal's row rules actually enforce. They agree today (both read the same
   * grant), but if they ever drifted the screens should follow the database.
   */
  canEdit: boolean;
  refresh: () => Promise<void>;
  categoryById: (id: string | null | undefined) => Category | undefined;
  printHeadById: (id: string | null | undefined) => PrintHead | undefined;
  masterById: (id: string | null | undefined) => MasterValue | undefined;
  /** A master's values in their sort order: active ones, plus `keepId` even if switched off. */
  mastersOf: (kind: MasterKind, keepId?: string | null) => MasterValue[];
  machineById: (id: string | null | undefined) => Machine | undefined;
  inquiryByKey: (key: string | null | undefined) => Inquiry | undefined;
  fieldByKey: (key: string) => FieldDef | undefined;
  setting: (key: string) => unknown;
  /** The status an inquiry starts at. The portal finds it by its text, "New". */
  newStatusId: string | null;
  salespeople: Salesperson[];
  salespeopleLoading: boolean;
  salespeopleError: unknown;
  sellers: SellerOption[];
  sellersLoading: boolean;
}

const Ctx = createContext<MrStore | null>(null);

export function MrStoreProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const configured = hasPortalConfig();

  const passQ = useQuery({
    queryKey: [...MR_QK, "pass"],
    queryFn: () => getPortalPass(),
    enabled: configured,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // A missing grant or a missing setup will not fix itself; a dropped call might.
    retry: (n, e) => n < 2 && !(e instanceof PortalError && e.kind !== "unavailable"),
  });

  const dataQ = useQuery({
    queryKey: MR_DATA_QK,
    queryFn: fetchMrData,
    enabled: configured && passQ.isSuccess,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const canEdit = passQ.data?.level === "edit";

  // Both pickers read the HUB, and only an editor ever picks. The salesperson list
  // in particular refuses anyone else, so a view-only user never asks for it.
  const peopleQ = useQuery({
    queryKey: MR_SALESPEOPLE_QK,
    queryFn: fetchSalespeople,
    enabled: canEdit,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const sellersQ = useQuery({
    queryKey: MR_SELLERS_QK,
    queryFn: fetchSellers,
    enabled: canEdit,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const data = dataQ.data ?? EMPTY;

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: MR_DATA_QK });
  }, [qc]);

  const value = useMemo<MrStore>(() => {
    const cat = new Map(data.categories.map((c) => [c.id, c]));
    const head = new Map(data.printHeads.map((h) => [h.id, h]));
    const master = new Map(data.masters.map((m) => [m.id, m]));
    const machine = new Map(data.machines.map((m) => [m.id, m]));
    const field = new Map(data.fields.map((f) => [f.key, f]));
    const settings = new Map(data.settings.map((s) => [s.key, s.value]));
    const newStatus = data.masters.find((m) => m.master === "inquiry_status" && m.value === "New");
    const notConfigured = configured
      ? null
      : new PortalError("not-configured", "Machine Resale is not set up on this server yet.");
    return {
      ...data,
      isLoading: configured && (passQ.isLoading || (passQ.isSuccess && dataQ.isLoading)),
      error: notConfigured ?? passQ.error ?? dataQ.error,
      pass: passQ.data ?? null,
      canEdit,
      refresh,
      categoryById: (id) => (id ? cat.get(id) : undefined),
      printHeadById: (id) => (id ? head.get(id) : undefined),
      masterById: (id) => (id ? master.get(id) : undefined),
      mastersOf: (kind, keepId) =>
        data.masters
          .filter((m) => m.master === kind && (m.active || m.id === keepId))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value)),
      machineById: (id) => (id ? machine.get(id) : undefined),
      inquiryByKey: (key) => {
        if (!key) return undefined;
        const k = key.toUpperCase();
        return data.inquiries.find((i) => i.id === key || i.inquiryNo === k);
      },
      fieldByKey: (key) => field.get(key),
      setting: (key) => settings.get(key),
      newStatusId: newStatus?.id ?? null,
      salespeople: peopleQ.data ?? [],
      salespeopleLoading: peopleQ.isLoading,
      salespeopleError: peopleQ.error,
      sellers: sellersQ.data ?? [],
      sellersLoading: sellersQ.isLoading,
    };
  }, [data, configured, passQ.isLoading, passQ.isSuccess, passQ.error, passQ.data, dataQ.isLoading, dataQ.error, canEdit, refresh, peopleQ.data, peopleQ.isLoading, peopleQ.error, sellersQ.data, sellersQ.isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMrStore(): MrStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMrStore must be used inside MrStoreProvider");
  return v;
}
