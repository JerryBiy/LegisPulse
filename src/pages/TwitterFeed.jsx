import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/apiClient";
import {
  getSessionDisplayName,
  useLegislativeSession,
} from "@/lib/LegislativeSessionContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import XIcon from "@/components/icons/XIcon";
import { AlertCircle, CheckCircle2, Info, Settings } from "lucide-react";
import XFeed from "../components/twitter/TwitterFeed";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { formatDistanceToNow } from "date-fns";

const DEFAULT_OFFICIAL_HANDLES = ["@GAHouseHub", "@GASenatePress"];

export default function XFeedPage() {
  const { state, selectedSession, selectedSessionId, isReady } =
    useLegislativeSession();
  const [personalBillNumbers, setPersonalBillNumbers] = useState([]);
  const [teamBillNumbers, setTeamBillNumbers] = useState([]);
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showAllPosts, setShowAllPosts] = useState(false);

  const sessionLabel = getSessionDisplayName(selectedSession);

  useEffect(() => {
    let active = true;
    setPersonalBillNumbers([]);
    setTeamBillNumbers([]);

    if (!isReady || !selectedSessionId) {
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const [userData, personalNumbers, teamNumbers, status] =
          await Promise.all([
            api.auth.me().catch(() => null),
            api.entities.TrackedBill.getNumbers(selectedSessionId, state),
            api.entities.Team.getAllTeamBillNumbers(selectedSessionId, state),
            api.entities.XPost.getSyncStatus(state).catch(() => null),
          ]);
        if (!active) return;
        setUser(userData);
        setPersonalBillNumbers(personalNumbers ?? []);
        setTeamBillNumbers(teamNumbers ?? []);
        setSyncStatus(status);
      } catch (error) {
        if (!active) return;
        console.error("Error loading X Feed data:", error);
        setPersonalBillNumbers([]);
        setTeamBillNumbers([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [isReady, selectedSessionId, state]);

  const monitoredBillNumbers = useMemo(
    () => [...new Set([...personalBillNumbers, ...teamBillNumbers])],
    [personalBillNumbers, teamBillNumbers],
  );
  const officialHandles =
    syncStatus?.monitored_handles?.length > 0
      ? syncStatus.monitored_handles
      : DEFAULT_OFFICIAL_HANDLES;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-slate-950 p-3">
              <XIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">X Feed</h1>
              <p className="mt-1 text-slate-600">
                Official Georgia legislative early alerts for {sessionLabel}
              </p>
            </div>
          </div>
          <Link to={createPageUrl("Settings")}>
            <Button variant="outline" className="gap-2">
              <Settings className="h-4 w-4" />
              Notification Settings
            </Button>
          </Link>
        </div>

        <Card className="border-slate-300 bg-white">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-slate-900">
                  Monitoring official legislative accounts
                </p>
                <div className="flex flex-wrap gap-2">
                  {officialHandles.map((handle) => (
                    <Badge key={handle} variant="outline" className="bg-slate-50">
                      {handle}
                    </Badge>
                  ))}
                </div>
                <p className="text-slate-600">
                  Posts are matched to this exact legislative session and bill
                  number. X creates an early alert only; LegiScan and official
                  legislative records remain authoritative.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={
            syncStatus?.last_error
              ? "border-red-200 bg-red-50"
              : syncStatus?.last_success_at
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
          }
        >
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            {syncStatus?.last_error ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            ) : syncStatus?.last_success_at ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div>
              <p className="font-medium text-slate-900">
                {syncStatus?.last_error
                  ? "X connection needs attention"
                  : syncStatus?.last_success_at
                    ? "X connection active"
                    : "Awaiting the first X sync"}
              </p>
              <p className="mt-1 text-slate-700">
                {syncStatus?.last_error
                  ? syncStatus.last_error
                  : syncStatus?.last_success_at
                    ? `Last checked ${formatDistanceToNow(
                        new Date(syncStatus.last_success_at),
                        { addSuffix: true },
                      )}. ${syncStatus.matched_count ?? 0} bill movement${
                        syncStatus.matched_count === 1 ? "" : "s"
                      } detected in that run.`
                    : "The server collector will begin after the X API Bearer Token is configured."}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-600">
                Personally Tracked
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {personalBillNumbers.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-600">Team Bills</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {teamBillNumbers.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-600">X Alerts</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-2xl font-bold text-slate-900">
                  {user?.twitter_notifications_enabled !== false ? "ON" : "OFF"}
                </p>
                <Badge
                  className={
                    user?.twitter_notifications_enabled !== false
                      ? "bg-green-100 text-green-800"
                      : "bg-slate-100 text-slate-800"
                  }
                >
                  {monitoredBillNumbers.length} unique bill
                  {monitoredBillNumbers.length === 1 ? "" : "s"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={!showAllPosts ? "default" : "outline"}
            onClick={() => setShowAllPosts(false)}
            className={!showAllPosts ? "bg-slate-950 hover:bg-slate-800" : ""}
          >
            My Bills (Personal + Team)
          </Button>
          <Button
            variant={showAllPosts ? "default" : "outline"}
            onClick={() => setShowAllPosts(true)}
            className={showAllPosts ? "bg-slate-950 hover:bg-slate-800" : ""}
          >
            All Official X Posts
          </Button>
        </div>

        <XFeed
          key={`${state}:${selectedSessionId || "loading"}`}
          state={state}
          sessionId={selectedSessionId}
          trackedBillNumbers={monitoredBillNumbers}
          showAllPosts={showAllPosts}
        />

        <Card className="border-slate-200">
          <CardContent className="p-6">
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
              <Info className="h-5 w-5 text-blue-500" />
              How X Early Alerts Work
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>Official House and Senate posts are checked automatically.</li>
              <li>
                Bill references are classified by session, bill type, and bill
                number; ambiguous regular/special-session posts are not guessed.
              </li>
              <li>
                Meaningful movements create one notification for each personal
                tracker and active member of a team containing that bill.
              </li>
              <li>
                The next LegiScan or official-record sync confirms the actual bill
                status independently of X.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
