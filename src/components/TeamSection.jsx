import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import {
  Users,
  UserPlus,
  Trash2,
  Star,
  Mail,
  LogOut,
  ChevronDown,
  LayoutGrid,
  List,
  ExternalLink,
  AlertTriangle,
  Shield,
  Sparkles,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Minimize2,
  X,
  Pencil,
  Check,
  CheckCircle,
  XCircle,
  Shield as ShieldIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import BillCard from "@/components/bills/BillCard";
import BillDetailsModal from "@/components/bills/BillDetailsModal";
import TeamChat from "@/components/TeamChat";
import { useResizableHeight, ResizeHandle } from "@/hooks/use-resizable-height";

// ── Constants ────────────────────────────────────────────────────────────────
const TEAM_COLORS = [
  { bg: "bg-indigo-100", fg: "text-indigo-600" },
  { bg: "bg-rose-100", fg: "text-rose-600" },
  { bg: "bg-amber-100", fg: "text-amber-600" },
  { bg: "bg-teal-100", fg: "text-teal-600" },
  { bg: "bg-violet-100", fg: "text-violet-600" },
  { bg: "bg-cyan-100", fg: "text-cyan-600" },
  { bg: "bg-pink-100", fg: "text-pink-600" },
  { bg: "bg-emerald-100", fg: "text-emerald-600" },
  { bg: "bg-orange-100", fg: "text-orange-600" },
  { bg: "bg-sky-100", fg: "text-sky-600" },
];
function teamColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

const PARTY_COLORS = {
  D: "bg-indigo-500 text-white",
  R: "bg-rose-500 text-white",
  I: "bg-slate-400 text-white",
  G: "bg-green-500 text-white",
  L: "bg-yellow-500 text-white",
};
const FLAG_ORDER = { high: 0, low: 1 };
const PARTY_ORDER = { D: 0, R: 1, I: 2, G: 3, L: 4 };

const extractBillNum = (bn) => {
  const m = String(bn || "").match(/^([A-Za-z]+)\s*(\d+)/);
  return m
    ? { prefix: m[1].toUpperCase(), num: parseInt(m[2], 10) }
    : { prefix: "", num: 0 };
};

/**
 * Renders one team: header, chat, bills, members.
 * Props:
 *   team       - team object { id, name, created_by, team_code, _role }
 *   onLeave    - callback after leaving
 *   defaultOpen - whether the team section starts open
 */
export default function TeamSection({ team, onLeave, defaultOpen = true }) {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const teamId = team.id;
  const isOwner = team.created_by === authUser?.id;

  // ── Section collapse (whole team) ─────────────────────────────────────────
  const [teamOpen, setTeamOpen] = useState(() => {
    const saved = localStorage.getItem(`team-open-${teamId}`);
    return saved !== null ? saved === "true" : defaultOpen;
  });
  React.useEffect(() => {
    localStorage.setItem(`team-open-${teamId}`, String(teamOpen));
  }, [teamOpen, teamId]);

  // ── Unread chat messages ─────────────────────────────────────────────────
  const chatCacheKey = ["teamChat", teamId, authUser?.id];
  const { data: cachedMessages = [] } = useQuery({
    queryKey: chatCacheKey,
    queryFn: () => api.entities.TeamChat.getMessages(teamId),
    enabled: !!teamId && !!authUser?.id,
    staleTime: Infinity, // don't refetch — TeamChat manages this
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const [lastChatRead, setLastChatRead] = useState(
    () => localStorage.getItem(`team-chat-read-${teamId}`) || null,
  );

  const unreadChatCount = useMemo(() => {
    if (!cachedMessages.length) return 0;
    if (!lastChatRead) return 0; // first mount = no unread
    return cachedMessages.filter(
      (m) =>
        m.user_id !== authUser?.id &&
        new Date(m.created_at) > new Date(lastChatRead),
    ).length;
  }, [cachedMessages, lastChatRead, authUser?.id]);

  // Mark chat as read when team section is open
  useEffect(() => {
    if (teamOpen && cachedMessages.length > 0) {
      const now = new Date().toISOString();
      localStorage.setItem(`team-chat-read-${teamId}`, now);
      setLastChatRead(now);
    }
  }, [teamOpen, cachedMessages.length, teamId]);

  // Initialize lastChatRead on first mount if not set
  useEffect(() => {
    if (
      !localStorage.getItem(`team-chat-read-${teamId}`) &&
      cachedMessages.length > 0
    ) {
      const now = new Date().toISOString();
      localStorage.setItem(`team-chat-read-${teamId}`, now);
      setLastChatRead(now);
    }
  }, [teamId, cachedMessages.length]);

  // ── Rename ─────────────────────────────────────────────────────────────────
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(team.name);
  const [renameError, setRenameError] = useState("");

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name cannot be empty.");
      return;
    }
    if (trimmed === team.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await api.entities.Team.renameTeam(teamId, trimmed);
      queryClient.invalidateQueries({ queryKey: ["allTeams"] });
      setIsRenaming(false);
      setRenameError("");
    } catch (err) {
      setRenameError(err?.message ?? "Failed to rename.");
    }
  };

  // ── Copy code ──────────────────────────────────────────────────────────────
  const [codeCopied, setCodeCopied] = useState(false);
  const handleCopyCode = () => {
    if (!team.team_code) return;
    navigator.clipboard.writeText(team.team_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // ── Sub-section collapse states ────────────────────────────────────────────
  const [membersOpen, setMembersOpen] = useState(() => {
    const saved = localStorage.getItem(`team-members-open-${teamId}`);
    return saved !== null ? saved === "true" : true;
  });
  const [billsOpen, setBillsOpen] = useState(() => {
    const saved = localStorage.getItem(`team-bills-open-${teamId}`);
    return saved !== null ? saved === "true" : true;
  });
  React.useEffect(() => {
    localStorage.setItem(`team-members-open-${teamId}`, String(membersOpen));
  }, [membersOpen, teamId]);
  React.useEffect(() => {
    localStorage.setItem(`team-bills-open-${teamId}`, String(billsOpen));
  }, [billsOpen, teamId]);

  // ── Bills layout & fullscreen ──────────────────────────────────────────────
  const [billsFullscreen, setBillsFullscreen] = useState(false);
  const {
    height: listHeight,
    collapsed: listCollapsed,
    onMouseDown: onListResizeDown,
    toggle: toggleListCollapse,
  } = useResizableHeight({
    storageKey: `team-bills-list-height-${teamId}`,
    defaultHeight: 480,
    minHeight: 150,
  });
  const [billsLayout, setBillsLayoutState] = useState(
    () => localStorage.getItem(`team-bills-layout-${teamId}`) || "icon",
  );
  const setBillsLayout = (v) => {
    setBillsLayoutState(v);
    localStorage.setItem(`team-bills-layout-${teamId}`, v);
  };

  // ── Sort ───────────────────────────────────────────────────────────────────
  const [listSort, setListSort] = useState({ key: null, dir: "asc" });
  const toggleSort = useCallback((key) => {
    setListSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);
  const SortIcon = ({ column }) => {
    if (listSort.key !== column)
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />;
    return listSort.dir === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
    );
  };

  // ── Data queries ───────────────────────────────────────────────────────────
  const { data: members = [] } = useQuery({
    queryKey: ["teamMembers", teamId],
    queryFn: () => api.entities.Team.getMembers(teamId),
    enabled: !!teamId,
  });

  const { data: teamBillNumbers = [] } = useQuery({
    queryKey: ["teamBills", teamId],
    queryFn: () => api.entities.Team.getBillNumbers(teamId),
    enabled: !!teamId,
  });

  const { data: allBills = [] } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.entities.Bill.list(),
  });

  const { data: userData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.auth.me().catch(() => null),
  });

  const { data: billMeta = {} } = useQuery({
    queryKey: ["teamBillMeta", teamId],
    queryFn: () => api.entities.Team.getBillMetadata(teamId),
    enabled: !!teamId,
  });

  const trackedBillIds = userData?.tracked_bill_ids ?? [];
  const teamBills = allBills.filter((b) =>
    teamBillNumbers.includes(b.bill_number),
  );
  const activeMembers = members.filter((m) => m.status === "active");

  // ── Sorted bills ───────────────────────────────────────────────────────────
  const sortedTeamBills = useMemo(() => {
    if (!listSort.key || billsLayout !== "list") return teamBills;
    const dir = listSort.dir === "asc" ? 1 : -1;
    return [...teamBills].sort((a, b) => {
      if (listSort.key === "bill") {
        const an = extractBillNum(a.bill_number);
        const bn = extractBillNum(b.bill_number);
        if (an.prefix !== bn.prefix) return an.prefix < bn.prefix ? -dir : dir;
        return (an.num - bn.num) * dir;
      }
      if (listSort.key === "party") {
        const ap = PARTY_ORDER[a.sponsor_party] ?? 99;
        const bp = PARTY_ORDER[b.sponsor_party] ?? 99;
        return (ap - bp) * dir;
      }
      if (listSort.key === "flag") {
        const am = billMeta[a.bill_number]?.flag;
        const bm = billMeta[b.bill_number]?.flag;
        return ((FLAG_ORDER[am] ?? 99) - (FLAG_ORDER[bm] ?? 99)) * dir;
      }
      return 0;
    });
  }, [teamBills, listSort, billsLayout, billMeta]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMetaMutation = useMutation({
    mutationFn: ({ billNumber, fields }) =>
      api.entities.Team.updateBillMetadata(teamId, billNumber, fields),
    onMutate: async ({ billNumber, fields }) => {
      await queryClient.cancelQueries({ queryKey: ["teamBillMeta", teamId] });
      const prev = queryClient.getQueryData(["teamBillMeta", teamId]);
      queryClient.setQueryData(["teamBillMeta", teamId], (old) => ({
        ...old,
        [billNumber]: { ...(old?.[billNumber] || {}), ...fields },
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) =>
      queryClient.setQueryData(["teamBillMeta", teamId], ctx.prev),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["teamBillMeta", teamId] }),
  });

  const handleMetaChange = useCallback(
    (billNumber, fields) => updateMetaMutation.mutate({ billNumber, fields }),
    [updateMetaMutation],
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");

  const inviteMutation = useMutation({
    mutationFn: (email) => api.entities.Team.inviteMember(teamId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
      setInviteEmail("");
      setInviteError("");
    },
    onError: (err) => setInviteError(err?.message ?? "Failed to invite."),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.removeMember(memberId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] }),
  });

  const approveJoinMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.approveJoinRequest(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pendingJoinRequests"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
    },
  });

  const declineJoinMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.declineJoinRequest(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pendingJoinRequests"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
    },
  });

  const removeBillMutation = useMutation({
    mutationFn: (billNumber) =>
      api.entities.Team.removeBill(teamId, billNumber),
    onMutate: async (billNumber) => {
      await queryClient.cancelQueries({ queryKey: ["teamBills", teamId] });
      const prev = queryClient.getQueryData(["teamBills", teamId]);
      queryClient.setQueryData(["teamBills", teamId], (old) =>
        (old ?? []).filter((n) => n !== billNumber),
      );
      return { prev };
    },
    onError: (_e, _b, ctx) =>
      queryClient.setQueryData(["teamBills", teamId], ctx.prev),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["teamBills", teamId] }),
  });

  // ── Leave team ─────────────────────────────────────────────────────────────
  const handleLeaveTeam = async () => {
    const otherActive = members.filter(
      (m) => m.status === "active" && m.user_id !== authUser?.id,
    );
    const confirmMsg = isOwner
      ? otherActive.length > 0
        ? `You are the team owner. Leaving will transfer ownership to ${otherActive[0]?.email ?? "the next member"}. Continue?`
        : "You are the only member. Leaving will permanently delete this team. Continue?"
      : "Are you sure you want to leave this team?";
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.entities.Team.leaveTeam(teamId);
      queryClient.invalidateQueries({ queryKey: ["allTeams"] });
      onLeave?.();
    } catch (err) {
      alert(err?.message ?? "Failed to leave team.");
    }
  };

  // ── Selected bill (for modal) ──────────────────────────────────────────────
  const [selectedBill, setSelectedBill] = useState(null);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Collapsible open={teamOpen} onOpenChange={setTeamOpen}>
      <Card className="overflow-hidden">
        {/* Team header — always visible */}
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className={`p-2 rounded-lg shrink-0 ${teamColor(teamId).bg}`}>
              <ShieldIcon className={`w-5 h-5 ${teamColor(teamId).fg}`} />
            </div>
            <div className="flex-1 min-w-0">
              {isRenaming && isOwner ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      setRenameError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") {
                        setIsRenaming(false);
                        setRenameValue(team.name);
                      }
                    }}
                    className="h-8 text-lg font-bold"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" onClick={handleRename}>
                    <Check className="w-4 h-4 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setIsRenaming(false);
                      setRenameValue(team.name);
                    }}
                  >
                    <X className="w-4 h-4 text-slate-400" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900 truncate">
                    {team.name}
                  </h2>
                  {unreadChatCount > 0 && !teamOpen && (
                    <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-red-500 text-white text-[11px] font-bold rounded-full leading-none">
                      {unreadChatCount > 99 ? "99+" : unreadChatCount}
                    </span>
                  )}
                  {isOwner && teamOpen && (
                    <button
                      onClick={() => {
                        setRenameValue(team.name);
                        setIsRenaming(true);
                      }}
                      className="p-1 rounded hover:bg-slate-100 transition-colors"
                      title="Rename team"
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )}
                </div>
              )}
              {renameError && (
                <p className="text-xs text-red-600 mt-1">{renameError}</p>
              )}
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                <span>
                  {isOwner ? "Owner" : "Member"} · {activeMembers.length} member
                  {activeMembers.length !== 1 ? "s" : ""}
                </span>
                {isOwner &&
                  members.filter((m) => m.status === "pending_approval")
                    .length > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-300 rounded-full text-[10px] font-semibold">
                      <UserPlus className="w-3 h-3" />
                      {
                        members.filter((m) => m.status === "pending_approval")
                          .length
                      }{" "}
                      join request
                      {members.filter((m) => m.status === "pending_approval")
                        .length !== 1
                        ? "s"
                        : ""}
                    </span>
                  )}
              </p>
            </div>

            {/* Team code */}
            {team.team_code && (
              <button
                onClick={handleCopyCode}
                title="Click to copy team code"
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors shrink-0"
              >
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                  Code
                </span>
                <span className="font-mono font-bold text-sm tracking-widest text-slate-800">
                  {team.team_code}
                </span>
                <span className="text-[9px] text-slate-400">
                  {codeCopied ? "✓ Copied!" : "Copy"}
                </span>
              </button>
            )}

            {/* Collapse toggle */}
            <CollapsibleTrigger asChild>
              <button className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0">
                <ChevronDown
                  className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${teamOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* ── Team Chat ─────────────────────────────────────── */}
            <TeamChat teamId={teamId} />

            {/* ── Team Bills ────────────────────────────────────── */}
            {billsFullscreen && (
              <div
                className="fixed inset-0 z-50 bg-black/40"
                onClick={() => setBillsFullscreen(false)}
              />
            )}
            <div
              className={
                billsFullscreen
                  ? "fixed inset-4 z-50 bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
                  : ""
              }
            >
              {billsFullscreen && (
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 shrink-0">
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <Star className="w-5 h-5 text-yellow-500" />
                    Team Bills ({teamBills.length})
                  </h2>
                  <button
                    onClick={() => setBillsFullscreen(false)}
                    className="p-1.5 rounded-md hover:bg-slate-100 transition-colors"
                    title="Exit fullscreen"
                  >
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>
              )}
              <div
                className={billsFullscreen ? "flex-1 overflow-auto p-6" : ""}
              >
                <Collapsible open={billsOpen} onOpenChange={setBillsOpen}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                          <Star className="w-4 h-4 text-yellow-500" />
                          Team Bills ({teamBills.length})
                        </h3>
                        {/* Layout toggle */}
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                          <button
                            onClick={() => {
                              setBillsLayout("icon");
                              setBillsFullscreen(false);
                            }}
                            className={`p-1.5 rounded-md transition-colors ${
                              billsLayout === "icon"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                            title="Card view"
                          >
                            <LayoutGrid className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setBillsLayout("list")}
                            className={`p-1.5 rounded-md transition-colors ${
                              billsLayout === "list"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                            title="List view"
                          >
                            <List className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {billsLayout === "list" && (
                          <button
                            onClick={() => {
                              if (!billsOpen) setBillsOpen(true);
                              setBillsFullscreen((f) => !f);
                            }}
                            className="p-1.5 rounded-md hover:bg-slate-100 transition-colors"
                            title={
                              billsFullscreen ? "Exit fullscreen" : "Fullscreen"
                            }
                          >
                            {billsFullscreen ? (
                              <Minimize2 className="w-4 h-4 text-slate-500" />
                            ) : (
                              <Maximize2 className="w-4 h-4 text-slate-500" />
                            )}
                          </button>
                        )}
                        <CollapsibleTrigger asChild>
                          <button className="p-1.5 rounded-md hover:bg-slate-100 transition-colors">
                            <ChevronDown
                              className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${billsOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    <CollapsibleContent>
                      {teamBills.length > 0 ? (
                        billsLayout === "icon" ? (
                          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                            {teamBills.map((bill) => {
                              const meta = billMeta[bill.bill_number] || {};
                              const assignee = meta.policy_assistant
                                ? activeMembers.find(
                                    (m) => m.user_id === meta.policy_assistant,
                                  )
                                : null;
                              return (
                                <BillCard
                                  key={bill.id}
                                  bill={bill}
                                  onViewDetails={setSelectedBill}
                                  onToggleTracking={() => {}}
                                  isTracked={trackedBillIds.includes(
                                    bill.bill_number,
                                  )}
                                  isInTeam={true}
                                  onAddToTeam={() =>
                                    removeBillMutation.mutate(bill.bill_number)
                                  }
                                  teamButtonLabel="Remove from Team"
                                  teamMeta={{
                                    ...meta,
                                    assigneeName: assignee?.email ?? null,
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          /* ── List / Spreadsheet View ──────────────── */
                          <div>
                            {listCollapsed && !billsFullscreen ? (
                              <Card
                                className="cursor-pointer hover:bg-slate-50 transition-colors"
                                onClick={toggleListCollapse}
                              >
                                <div className="text-center py-3 text-sm text-slate-400">
                                  List collapsed — click or drag to expand
                                </div>
                              </Card>
                            ) : (
                              <Card>
                                <div
                                  className={`overflow-x-auto ${!billsFullscreen ? "overflow-y-auto" : ""}`}
                                  style={
                                    !billsFullscreen
                                      ? { maxHeight: `${listHeight}px` }
                                      : undefined
                                  }
                                >
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-slate-50">
                                        <TableHead className="w-[100px] font-semibold">
                                          <button
                                            className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                            onClick={() => toggleSort("bill")}
                                          >
                                            Bill # <SortIcon column="bill" />
                                          </button>
                                        </TableHead>
                                        <TableHead className="min-w-[200px] font-semibold">
                                          Title
                                        </TableHead>
                                        <TableHead className="min-w-[160px] font-semibold">
                                          Primary Sponsor
                                        </TableHead>
                                        <TableHead className="w-[90px] font-semibold">
                                          <button
                                            className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                            onClick={() => toggleSort("party")}
                                          >
                                            Party <SortIcon column="party" />
                                          </button>
                                        </TableHead>
                                        <TableHead className="min-w-[140px] font-semibold">
                                          Committee
                                        </TableHead>
                                        <TableHead className="w-[110px] font-semibold">
                                          <button
                                            className="flex items-center gap-1 hover:text-blue-700 transition-colors"
                                            onClick={() => toggleSort("flag")}
                                          >
                                            Flag <SortIcon column="flag" />
                                          </button>
                                        </TableHead>
                                        <TableHead className="w-[60px] font-semibold">
                                          Link
                                        </TableHead>
                                        <TableHead className="min-w-[150px] font-semibold">
                                          Policy Assistant
                                        </TableHead>
                                        <TableHead className="min-w-[200px] font-semibold">
                                          Bill Summary
                                        </TableHead>
                                        <TableHead className="min-w-[200px] font-semibold">
                                          <span className="flex items-center gap-1">
                                            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                            AI Summary
                                          </span>
                                        </TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {sortedTeamBills.map((bill) => {
                                        const meta =
                                          billMeta[bill.bill_number] || {};
                                        return (
                                          <TableRow
                                            key={bill.id}
                                            className="align-top"
                                          >
                                            <TableCell className="font-mono font-semibold text-blue-700 whitespace-nowrap">
                                              <button
                                                className="hover:underline text-left"
                                                onClick={() =>
                                                  setSelectedBill(bill)
                                                }
                                              >
                                                {bill.bill_number}
                                              </button>
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-700 max-w-[280px]">
                                              <span className="line-clamp-2">
                                                {bill.title}
                                              </span>
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-700 whitespace-nowrap">
                                              {bill.sponsor || "Unknown"}
                                            </TableCell>
                                            <TableCell>
                                              {bill.sponsor_party ? (
                                                <span
                                                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-semibold ${PARTY_COLORS[bill.sponsor_party] || "bg-slate-200 text-slate-700"}`}
                                                >
                                                  {bill.sponsor_party === "D"
                                                    ? "Democrat"
                                                    : bill.sponsor_party === "R"
                                                      ? "Republican"
                                                      : bill.sponsor_party}
                                                </span>
                                              ) : (
                                                <span className="text-xs text-slate-400">
                                                  —
                                                </span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-700">
                                              {bill.current_committee ? (
                                                <Badge
                                                  variant="outline"
                                                  className="text-xs font-normal"
                                                >
                                                  {bill.current_committee}
                                                </Badge>
                                              ) : (
                                                <span className="text-xs text-slate-400">
                                                  —
                                                </span>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              <Select
                                                value={meta.flag || "_none"}
                                                onValueChange={(val) =>
                                                  handleMetaChange(
                                                    bill.bill_number,
                                                    {
                                                      flag:
                                                        val === "_none"
                                                          ? null
                                                          : val,
                                                    },
                                                  )
                                                }
                                              >
                                                <SelectTrigger className="h-8 text-xs w-[100px]">
                                                  <SelectValue placeholder="—" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="_none">
                                                    <span className="text-slate-400">
                                                      None
                                                    </span>
                                                  </SelectItem>
                                                  <SelectItem value="low">
                                                    <span className="flex items-center gap-1 text-green-700">
                                                      <Shield className="w-3 h-3" />{" "}
                                                      Low Risk
                                                    </span>
                                                  </SelectItem>
                                                  <SelectItem value="high">
                                                    <span className="flex items-center gap-1 text-red-700">
                                                      <AlertTriangle className="w-3 h-3" />{" "}
                                                      High Risk
                                                    </span>
                                                  </SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </TableCell>
                                            <TableCell>
                                              {bill.url ? (
                                                <a
                                                  href={bill.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-blue-600 hover:text-blue-800"
                                                >
                                                  <ExternalLink className="w-4 h-4" />
                                                </a>
                                              ) : (
                                                <span className="text-xs text-slate-400">
                                                  —
                                                </span>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              <Select
                                                value={
                                                  meta.policy_assistant ||
                                                  "_none"
                                                }
                                                onValueChange={(val) =>
                                                  handleMetaChange(
                                                    bill.bill_number,
                                                    {
                                                      policy_assistant:
                                                        val === "_none"
                                                          ? null
                                                          : val,
                                                    },
                                                  )
                                                }
                                              >
                                                <SelectTrigger className="h-8 text-xs w-[140px]">
                                                  <SelectValue placeholder="Assign..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="_none">
                                                    <span className="text-slate-400">
                                                      Unassigned
                                                    </span>
                                                  </SelectItem>
                                                  {activeMembers.map((m) => (
                                                    <SelectItem
                                                      key={m.user_id}
                                                      value={m.user_id}
                                                    >
                                                      {m.email}
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            </TableCell>
                                            <TableCell>
                                              <Textarea
                                                placeholder="Add notes..."
                                                className="text-xs min-h-[60px] resize-y w-full"
                                                value={
                                                  meta.bill_summary_notes || ""
                                                }
                                                onChange={(e) =>
                                                  queryClient.setQueryData(
                                                    ["teamBillMeta", teamId],
                                                    (old) => ({
                                                      ...old,
                                                      [bill.bill_number]: {
                                                        ...(old?.[
                                                          bill.bill_number
                                                        ] || {}),
                                                        bill_summary_notes:
                                                          e.target.value,
                                                      },
                                                    }),
                                                  )
                                                }
                                                onBlur={(e) =>
                                                  handleMetaChange(
                                                    bill.bill_number,
                                                    {
                                                      bill_summary_notes:
                                                        e.target.value,
                                                    },
                                                  )
                                                }
                                              />
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-600 max-w-[240px]">
                                              {bill.summary ? (
                                                <TooltipProvider>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <p className="line-clamp-3 cursor-help">
                                                        {bill.summary}
                                                      </p>
                                                    </TooltipTrigger>
                                                    <TooltipContent
                                                      side="left"
                                                      className="max-w-sm text-xs whitespace-pre-line"
                                                    >
                                                      {bill.summary}
                                                    </TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              ) : (
                                                <span className="text-slate-400 italic">
                                                  No AI summary
                                                </span>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </Card>
                            )}
                            {!billsFullscreen && (
                              <ResizeHandle onMouseDown={onListResizeDown} />
                            )}
                          </div>
                        )
                      ) : (
                        <div className="text-center py-8 bg-slate-50 rounded-lg border border-slate-200">
                          <Star className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                          <p className="text-sm text-slate-500">
                            No team bills yet. Use "Add to Team" from the
                            Dashboard.
                          </p>
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
            </div>

            {/* ── Members ───────────────────────────────────────── */}
            <Collapsible open={membersOpen} onOpenChange={setMembersOpen}>
              <div className="space-y-3">
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between w-full text-left">
                    <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Members (
                      {members.filter((m) => m.status === "active").length})
                      {isOwner &&
                        members.some(
                          (m) => m.status === "pending_approval",
                        ) && (
                          <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100">
                            {
                              members.filter(
                                (m) => m.status === "pending_approval",
                              ).length
                            }{" "}
                            request
                            {members.filter(
                              (m) => m.status === "pending_approval",
                            ).length > 1
                              ? "s"
                              : ""}
                          </Badge>
                        )}
                    </h3>
                    <ChevronDown
                      className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${membersOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          member.status === "pending_approval"
                            ? "bg-amber-50 border border-amber-200"
                            : "bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              member.status === "pending_approval"
                                ? "bg-amber-100"
                                : "bg-blue-100"
                            }`}
                          >
                            <span
                              className={`text-sm font-semibold ${
                                member.status === "pending_approval"
                                  ? "text-amber-600"
                                  : "text-blue-600"
                              }`}
                            >
                              {member.email?.[0]?.toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {member.email}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge
                                variant="outline"
                                className="text-xs capitalize"
                              >
                                {member.role}
                              </Badge>
                              {member.status === "pending" && (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-orange-600 border-orange-200"
                                >
                                  Pending Invite
                                </Badge>
                              )}
                              {member.status === "pending_approval" && (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-amber-600 border-amber-200"
                                >
                                  Wants to Join
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {isOwner && member.status === "pending_approval" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() =>
                                  approveJoinMutation.mutate(member.id)
                                }
                                disabled={
                                  approveJoinMutation.isPending ||
                                  declineJoinMutation.isPending
                                }
                                title="Approve"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() =>
                                  declineJoinMutation.mutate(member.id)
                                }
                                disabled={
                                  approveJoinMutation.isPending ||
                                  declineJoinMutation.isPending
                                }
                                title="Decline"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {isOwner &&
                            member.user_id !== authUser?.id &&
                            member.status !== "pending_approval" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() =>
                                  removeMemberMutation.mutate(member.id)
                                }
                                disabled={removeMemberMutation.isPending}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Leave team */}
                  <div className="pt-3 mt-3 border-t border-slate-200">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={handleLeaveTeam}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {isOwner ? "Leave & Transfer Ownership" : "Leave Team"}
                    </Button>
                  </div>

                  {/* Invite (owner only) */}
                  {isOwner && (
                    <div className="pt-3 mt-3 border-t border-slate-200 space-y-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <Input
                            type="email"
                            placeholder="Invite by email address..."
                            value={inviteEmail}
                            onChange={(e) => {
                              setInviteEmail(e.target.value);
                              setInviteError("");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && inviteEmail.trim())
                                inviteMutation.mutate(inviteEmail.trim());
                            }}
                            className="pl-10"
                          />
                        </div>
                        <Button
                          onClick={() =>
                            inviteMutation.mutate(inviteEmail.trim())
                          }
                          disabled={
                            !inviteEmail.trim() || inviteMutation.isPending
                          }
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 gap-2"
                        >
                          <UserPlus className="w-4 h-4" />
                          Invite
                        </Button>
                      </div>
                      {inviteError && (
                        <p className="text-sm text-red-600">{inviteError}</p>
                      )}
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          </CardContent>
        </CollapsibleContent>
      </Card>

      {/* Bill Details Modal */}
      <BillDetailsModal
        bill={selectedBill}
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        isTracked={
          selectedBill
            ? trackedBillIds.includes(selectedBill.bill_number)
            : false
        }
        onToggleTracking={() => {}}
        onBillUpdate={() => {}}
        isInTeam={
          selectedBill
            ? teamBillNumbers.includes(selectedBill.bill_number)
            : false
        }
        onAddToTeam={() => {
          if (selectedBill) removeBillMutation.mutate(selectedBill.bill_number);
        }}
        teamMeta={
          selectedBill ? billMeta[selectedBill.bill_number] || {} : undefined
        }
        onTeamMetaChange={
          selectedBill
            ? (fields) => handleMetaChange(selectedBill.bill_number, fields)
            : undefined
        }
        teamMembers={activeMembers}
        personalMeta={undefined}
        onPersonalMetaChange={undefined}
      />
    </Collapsible>
  );
}
