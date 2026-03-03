import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import {
  Users,
  UserPlus,
  Trash2,
  Star,
  Mail,
  UserCheck,
  CheckCircle,
  XCircle,
  LogOut,
  Hash,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function Team() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [selectedBill, setSelectedBill] = useState(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joiningTeam, setJoiningTeam] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => {
    const saved = localStorage.getItem("team-members-open");
    return saved !== null ? saved === "true" : true; // default open
  });
  const [billsOpen, setBillsOpen] = useState(() => {
    const saved = localStorage.getItem("team-bills-open");
    return saved !== null ? saved === "true" : true;
  });
  const [billsFullscreen, setBillsFullscreen] = useState(false);
  const {
    height: listHeight,
    collapsed: listCollapsed,
    onMouseDown: onListResizeDown,
    toggle: toggleListCollapse,
  } = useResizableHeight({
    storageKey: "team-bills-list-height",
    defaultHeight: 480,
    minHeight: 150,
  });
  const [billsLayout, setBillsLayoutState] = useState(
    () => localStorage.getItem("team-bills-layout") || "icon",
  );
  const setBillsLayout = (v) => {
    setBillsLayoutState(v);
    localStorage.setItem("team-bills-layout", v);
  };
  const [listSort, setListSort] = useState({ key: null, dir: "asc" }); // key: "bill" | "party" | "flag"
  const scrollRestored = useRef(false);
  const pageRef = useRef(null);

  // Persist collapse states
  useEffect(() => {
    localStorage.setItem("team-members-open", String(membersOpen));
  }, [membersOpen]);
  useEffect(() => {
    localStorage.setItem("team-bills-open", String(billsOpen));
  }, [billsOpen]);

  // Find the scrollable parent (Layout's overflow-auto container)
  const getScrollContainer = useCallback(() => {
    let el = pageRef.current;
    while (el) {
      const style = getComputedStyle(el);
      if (style.overflow === "auto" || style.overflowY === "auto") return el;
      el = el.parentElement;
    }
    return null;
  }, []);

  // Save scroll position on scroll
  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;
    const handleScroll = () => {
      sessionStorage.setItem("team-scroll-y", String(container.scrollTop));
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [getScrollContainer]);

  // Restore scroll position once after mount
  useEffect(() => {
    if (scrollRestored.current) return;
    scrollRestored.current = true;
    const savedY = parseInt(sessionStorage.getItem("team-scroll-y") || "0", 10);
    if (savedY > 0) {
      requestAnimationFrame(() => {
        const container = getScrollContainer();
        if (container) container.scrollTop = savedY;
      });
    }
  }, [getScrollContainer]);

  // Load the current user's team (no auto-create — returns null if user has no team)
  const {
    data: team,
    isLoading: loadingTeam,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.entities.Team.get(),
    staleTime: 0,
    retry: 1,
  });

  const hasPendingInvite = team?.__pendingInvite === true;

  // Pending invites for this user (shown when hasPendingInvite)
  const { data: pendingInvites = [], refetch: refetchPending } = useQuery({
    queryKey: ["pendingInvites"],
    queryFn: () => api.entities.Team.getPendingInvites(),
    enabled: hasPendingInvite,
    staleTime: 0,
  });

  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const handleAcceptInvite = async () => {
    setIsAccepting(true);
    setAcceptError("");
    try {
      await api.entities.Team.acceptPendingInvites();
      // Force refetch team query — don't just invalidate, wait for fresh data
      await queryClient.refetchQueries({ queryKey: ["team"] });
      await queryClient.invalidateQueries({ queryKey: ["pendingInvites"] });
    } catch (err) {
      console.error("[Accept invite]", err);
      setAcceptError(
        err?.message ??
          "Failed to accept invite. Make sure the RLS SQL has been run in Supabase.",
      );
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDeclineInvite = async (invite) => {
    try {
      await api.entities.Team.declineInvite(invite.id);
      await queryClient.refetchQueries({ queryKey: ["team"] });
      await queryClient.invalidateQueries({ queryKey: ["pendingInvites"] });
    } catch (err) {
      console.error("[Decline invite]", err);
    }
  };

  const teamId = team?.id;

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

  // Fetch team bill metadata (flag, policy_assistant, notes)
  const { data: billMeta = {} } = useQuery({
    queryKey: ["teamBillMeta", teamId],
    queryFn: () => api.entities.Team.getBillMetadata(teamId),
    enabled: !!teamId,
  });

  const trackedBillIds = userData?.tracked_bill_ids ?? [];
  const teamBills = allBills.filter((b) =>
    teamBillNumbers.includes(b.bill_number),
  );
  const isOwner = team?.created_by === authUser?.id;

  // ── Metadata update helpers ────────────────────────────────────────────────
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
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(["teamBillMeta", teamId], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["teamBillMeta", teamId] });
    },
  });

  const handleMetaChange = useCallback(
    (billNumber, fields) => {
      updateMetaMutation.mutate({ billNumber, fields });
    },
    [updateMetaMutation],
  );

  const activeMembers = members.filter((m) => m.status === "active");

  // Party color mapping
  const PARTY_COLORS = {
    D: "bg-indigo-500 text-white",
    R: "bg-rose-500 text-white",
    I: "bg-slate-400 text-white",
    G: "bg-green-500 text-white",
    L: "bg-yellow-500 text-white",
  };

  // ── Sort helpers for list view ─────────────────────────────────────────────
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

  const extractBillNum = (bn) => {
    const m = String(bn || "").match(/^([A-Za-z]+)\s*(\d+)/);
    return m
      ? { prefix: m[1].toUpperCase(), num: parseInt(m[2], 10) }
      : { prefix: "", num: 0 };
  };

  const FLAG_ORDER = { high: 0, low: 1 };
  const PARTY_ORDER = { D: 0, R: 1, I: 2, G: 3, L: 4 };

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
        const af = FLAG_ORDER[am] ?? 99;
        const bf = FLAG_ORDER[bm] ?? 99;
        return (af - bf) * dir;
      }
      return 0;
    });
  }, [teamBills, listSort, billsLayout, billMeta]);

  const handleLeaveTeam = async () => {
    const activeMembers = members.filter(
      (m) => m.status === "active" && m.user_id !== authUser?.id,
    );
    const confirmMsg = isOwner
      ? activeMembers.length > 0
        ? `You are the team owner. Leaving will transfer ownership to ${activeMembers[0]?.email ?? "the next member"}. Continue?`
        : "You are the only member. Leaving will permanently delete this team. Continue?"
      : "Are you sure you want to leave this team?";
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.entities.Team.leaveTeam(teamId);
      queryClient.setQueryData(["team"], null); // show no-team screen immediately
      queryClient.removeQueries({ queryKey: ["teamMembers", teamId] });
      queryClient.removeQueries({ queryKey: ["teamBills", teamId] });
    } catch (err) {
      console.error("[Leave team]", err);
      alert(err?.message ?? "Failed to leave team.");
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) {
      setCreateTeamError("Please enter a team name.");
      return;
    }
    setCreatingTeam(true);
    setCreateTeamError("");
    try {
      const created = await api.entities.Team.createTeam(newTeamName);
      queryClient.setQueryData(["team"], created);
      setNewTeamName("");
    } catch (err) {
      setCreateTeamError(err?.message ?? "Failed to create team.");
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) {
      setJoinError("Please enter a team code.");
      return;
    }
    setJoiningTeam(true);
    setJoinError("");
    try {
      const joined = await api.entities.Team.joinByCode(joinCode);
      queryClient.setQueryData(["team"], joined);
      setJoinCode("");
    } catch (err) {
      setJoinError(err?.message ?? "Invalid code or unable to join.");
    } finally {
      setJoiningTeam(false);
    }
  };

  const handleCopyCode = () => {
    if (!team?.team_code) return;
    navigator.clipboard.writeText(team.team_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const inviteMutation = useMutation({
    mutationFn: (email) => api.entities.Team.inviteMember(teamId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
      setInviteEmail("");
      setInviteError("");
    },
    onError: (err) => {
      setInviteError(err?.message ?? "Failed to invite member.");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.removeMember(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
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
    onError: (_e, _b, ctx) => {
      queryClient.setQueryData(["teamBills", teamId], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["teamBills", teamId] });
    },
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingTeam) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── No team screen ────────────────────────────────────────────────────────
  if (!team) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-5">
          <div className="text-center space-y-2">
            <div className="inline-flex p-4 bg-slate-100 rounded-full mb-2">
              <Users className="w-8 h-8 text-slate-500" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">No Team Yet</h1>
            <p className="text-slate-500 text-sm">
              Create a new team or join an existing one with a team code.
            </p>
          </div>

          {/* Create team */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" />
                Create a New Team
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Team name"
                value={newTeamName}
                onChange={(e) => {
                  setNewTeamName(e.target.value);
                  setCreateTeamError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
              />
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 gap-2"
                onClick={handleCreateTeam}
                disabled={creatingTeam}
              >
                {creatingTeam ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                Create Team
              </Button>
              {createTeamError && (
                <p className="text-sm text-red-600">{createTeamError}</p>
              )}
            </CardContent>
          </Card>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs text-slate-400 uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          {/* Join by code */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Hash className="w-4 h-4 text-green-600" />
                Join with a Team Code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="5-character code (e.g. A3K7P)"
                value={joinCode}
                maxLength={5}
                className="uppercase tracking-widest font-mono"
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase());
                  setJoinError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleJoinByCode()}
              />
              <Button
                className="w-full bg-green-600 hover:bg-green-700 gap-2"
                onClick={handleJoinByCode}
                disabled={joiningTeam}
              >
                {joiningTeam ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Join Team
              </Button>
              {joinError && <p className="text-sm text-red-600">{joinError}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Pending invite screen ──────────────────────────────────────────────────
  if (hasPendingInvite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4">
          <div className="text-center space-y-2">
            <div className="inline-flex p-4 bg-blue-100 rounded-full mb-2">
              <UserCheck className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Team Invitation
            </h1>
            <p className="text-slate-600">
              You've been invited to join a team.
            </p>
          </div>

          {pendingInvites.map((invite) => (
            <Card key={invite.id} className="border-blue-200">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">
                      {invite.teams?.name ?? "A team"}
                    </p>
                    <p className="text-sm text-slate-500">
                      You were invited as a member
                    </p>
                  </div>
                </div>

                {/* Warning: owner with other members — ownership will be transferred */}
                {team.__isOwner && team.__ownedTeamMemberCount > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <LogOut className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      <span className="font-semibold">Heads up:</span> You own{" "}
                      <span className="font-semibold">
                        {team.__currentTeamName}
                      </span>
                      . Accepting will transfer ownership to the next member and
                      add you to{" "}
                      <span className="font-semibold">
                        {invite.teams?.name ?? "the new team"}
                      </span>
                      .
                    </p>
                  </div>
                )}

                {/* Warning: owner with no other members — team will be deleted */}
                {team.__isOwner &&
                  team.__ownedTeamMemberCount === 0 &&
                  team.__currentTeamName && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                      <LogOut className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800">
                        <span className="font-semibold">Heads up:</span> You own{" "}
                        <span className="font-semibold">
                          {team.__currentTeamName}
                        </span>
                        . Since it has no other members, accepting will{" "}
                        <span className="font-semibold">
                          permanently delete
                        </span>{" "}
                        that team and add you to{" "}
                        <span className="font-semibold">
                          {invite.teams?.name ?? "the new team"}
                        </span>
                        .
                      </p>
                    </div>
                  )}

                {/* Warning: active member of another team */}
                {!team.__isOwner && team.__currentTeamName && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <LogOut className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      <span className="font-semibold">Heads up:</span> You're
                      currently in{" "}
                      <span className="font-semibold">
                        {team.__currentTeamName}
                      </span>
                      . Accepting will remove you from that team and add you to{" "}
                      <span className="font-semibold">
                        {invite.teams?.name ?? "the new team"}
                      </span>
                      .
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    className={`flex-1 gap-2 ${
                      team.__currentTeamName
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    onClick={handleAcceptInvite}
                    disabled={isAccepting}
                  >
                    {isAccepting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {team.__isOwner && team.__ownedTeamMemberCount > 0
                      ? "Transfer Ownership & Join"
                      : team.__currentTeamName
                        ? "Leave & Join New Team"
                        : "Accept & Join"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => handleDeclineInvite(invite)}
                    disabled={isAccepting}
                  >
                    <XCircle className="w-4 h-4" />
                    Decline
                  </Button>
                </div>
                {acceptError && (
                  <p className="text-sm text-red-600 mt-2">{acceptError}</p>
                )}
              </CardContent>
            </Card>
          ))}

          {pendingInvites.length === 0 && (
            <Card>
              <CardContent className="p-5 text-center text-slate-500 text-sm">
                Loading invitation details...
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={pageRef} className="min-h-full bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-green-100 rounded-lg">
            <Users className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold text-slate-900">{team?.name}</h1>
            <p className="text-slate-600 mt-1">Shared bills and team members</p>
          </div>
          {team?.team_code && (
            <button
              onClick={handleCopyCode}
              title="Click to copy team code"
              className="flex flex-col items-center gap-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors group"
            >
              <span className="text-xs text-slate-400 group-hover:text-slate-500 uppercase tracking-wide">
                Team Code
              </span>
              <span className="font-mono font-bold text-lg tracking-widest text-slate-800">
                {team.team_code}
              </span>
              <span className="text-[10px] text-slate-400">
                {codeCopied ? "✓ Copied!" : "Click to copy"}
              </span>
            </button>
          )}
        </div>

        {/* Team Chat */}
        <TeamChat teamId={teamId} />

        {/* Team Bills */}
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
          <div className={billsFullscreen ? "flex-1 overflow-auto p-6" : ""}>
            <Collapsible open={billsOpen} onOpenChange={setBillsOpen}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                      <Star className="w-5 h-5 text-yellow-500" />
                      Team Bills ({teamBills.length})
                    </h2>

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

                  {/* Fullscreen toggle */}
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

                    {/* Collapse toggle */}
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
                      /* ── List / Spreadsheet View ─────────────────────────── */
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
                                        {/* Bill Number */}
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

                                        {/* Title */}
                                        <TableCell className="text-sm text-slate-700 max-w-[280px]">
                                          <span className="line-clamp-2">
                                            {bill.title}
                                          </span>
                                        </TableCell>

                                        {/* Primary Sponsor */}
                                        <TableCell className="text-sm text-slate-700 whitespace-nowrap">
                                          {bill.sponsor || "Unknown"}
                                        </TableCell>

                                        {/* Party */}
                                        <TableCell>
                                          {bill.sponsor_party ? (
                                            <span
                                              className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-semibold ${
                                                PARTY_COLORS[
                                                  bill.sponsor_party
                                                ] ||
                                                "bg-slate-200 text-slate-700"
                                              }`}
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

                                        {/* Committee */}
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

                                        {/* Flag */}
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

                                        {/* Link */}
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

                                        {/* Policy Assistant */}
                                        <TableCell>
                                          <Select
                                            value={
                                              meta.policy_assistant || "_none"
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

                                        {/* Bill Summary (editable notes) */}
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

                                        {/* AI Summary (read-only) */}
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
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                      <Star className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-slate-900 mb-2">
                        No team bills yet
                      </h3>
                      <p className="text-slate-600">
                        Use the "Add to Team" button on any bill in the
                        Dashboard to share it with your team.
                      </p>
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        </div>

        {/* Members */}
        <Collapsible open={membersOpen} onOpenChange={setMembersOpen}>
          <Card>
            <CardHeader>
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full text-left">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Team Members ({members.length})
                  </CardTitle>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${membersOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 text-sm font-semibold">
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
                                Pending invite
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {isOwner && member.user_id !== authUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => removeMemberMutation.mutate(member.id)}
                          disabled={removeMemberMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {members.length === 0 && (
                    <p className="text-sm text-slate-500 italic">
                      No members yet. Invite someone below.
                    </p>
                  )}
                </div>

                {/* Leave team */}
                <div className="pt-3 border-t border-slate-200">
                  <Button
                    variant="outline"
                    className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleLeaveTeam}
                  >
                    <LogOut className="w-4 h-4" />
                    {isOwner ? "Leave & Transfer Ownership" : "Leave Team"}
                  </Button>
                </div>

                {/* Invite form (owner only) */}
                {isOwner && (
                  <div className="pt-3 border-t border-slate-200 space-y-2">
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
                            if (e.key === "Enter" && inviteEmail.trim()) {
                              inviteMutation.mutate(inviteEmail.trim());
                            }
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
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

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
      />
    </div>
  );
}
